import CryptoKit
import ExpoModulesCore
import Foundation

/**
 * RPA1 — chunked AES-256-GCM file encryption, implemented with CryptoKit only (no
 * OpenSSL, no third-party crypto). Plan W4.5 / GATE M9 (see `status.md`, architect
 * entry 2026-09-26T12:08:20Z, locked by Isaac's GATE M9 crossing 2026-09-27T20:05:00Z).
 *
 * This file mirrors, byte-for-byte, the algorithm documented and unit-tested in
 * `mobile/lib/crypto/rpa1Format.ts` and its Jest-run reference codec
 * (`mobile/lib/crypto/testSupport/rpa1ReferenceCodec.ts`) — see those files' docstrings
 * for the full design rationale (header layout, per-chunk AAD, the final-chunk
 * boundary rule, why a key-id mismatch is checked before any GCM operation runs). If
 * you change the byte layout here, change it there too and re-run `rpa1.test.ts` — the
 * two are meant to be provably in lockstep even though only the TS side is
 * Jest-executable in this project's CI.
 *
 * Streams file-to-file via `FileHandle`, one chunk (default 256 KiB plaintext) at a
 * time, so memory stays constant regardless of file size — the whole reason this is a
 * native module rather than a third-party JSI crypto library (see the architect's
 * writeup: RNQC requires New Architecture, which this app does not run).
 */
public class RpaCryptoModule: Module {
  public func definition() -> ModuleDefinition {
    Name("RpaCrypto")

    AsyncFunction("generateInstallKeyBase64") { () -> String in
      try RpaCrypto.generateInstallKeyBase64()
    }

    AsyncFunction("encryptFile") { (srcUri: String, dstUri: String, installKeyBase64: String, chunkSize: Double) -> [String: Any] in
      try RpaCrypto.encryptFile(
        srcUri: srcUri,
        dstUri: dstUri,
        installKeyBase64: installKeyBase64,
        chunkSize: UInt32(chunkSize)
      )
    }

    AsyncFunction("decryptFile") { (srcUri: String, dstUri: String, installKeyBase64: String) -> [String: Any] in
      try RpaCrypto.decryptFile(srcUri: srcUri, dstUri: dstUri, installKeyBase64: installKeyBase64)
    }

    AsyncFunction("readHeaderInfo") { (uri: String) -> [String: Any] in
      try RpaCrypto.readHeaderInfo(uri: uri)
    }

    AsyncFunction("excludeFromBackup") { (uri: String) -> Bool in
      try RpaCrypto.excludeFromBackup(uri: uri)
    }
  }
}

// MARK: - RPA1 constants (must match rpa1Format.ts exactly)

private enum RpaConst {
  static let magic: [UInt8] = [0x52, 0x50, 0x41, 0x31] // ASCII "RPA1"
  static let formatVersion: UInt8 = 1
  static let algorithmAes256Gcm: UInt8 = 1
  static let keyIdLen = 8
  static let fileSaltLen = 16
  static let headerLen = 4 + 1 + 1 + keyIdLen + 4 + fileSaltLen // 34
  static let nonceLen = 12
  static let tagLen = 16
  static let chunkOverhead = nonceLen + tagLen // 28
  static let defaultChunkSize: UInt32 = 256 * 1024
}

/**
 * A real `ExpoModulesCore.Exception` subclass with a stable `code` the JS side switches
 * on (see `modules/rpa-crypto/index.ts`) — mirrors `android/.../RpaCryptoModule.kt`'s
 * `RpaException : CodedException(...)` exactly, and for the same reason.
 *
 * The previous shape here (`Error, CustomNSError`) was a real, must-fix bug caught by
 * `reviewer-gilfoyle`: `AsyncFunctionDefinition.swift`'s catch blocks only recognize
 * `catch let error as Exception` — a plain `CustomNSError` conformance falls through to
 * the generic `catch { callback(.failure(UnexpectedException(error))) }` branch instead,
 * so on a real iPhone every one of this module's throws (including
 * `E_RPA1_KEY_MISMATCH`) would have surfaced to JS as a generic, uncoded exception
 * instead of the specific `RpaErrorCode` `lib/downloads/downloadManager.ts` switches on
 * to degrade key-loss gracefully. `Exception` is a class (not a protocol) in this SDK
 * version, so the fix is to subclass it — `GenericException`'s own shape in
 * `node_modules/expo-modules-core/ios/Core/Exceptions/GenericException.swift` is the
 * confirmed-correct pattern this mirrors (including forwarding `file`/`line`/`function`
 * to `super.init`, so `Exception.origin` still points at this module's own throw site
 * rather than `Exception.swift`'s default-argument definition site).
 */
private final class RpaError: Exception {
  private let rpaCode: String
  private let rpaMessage: String

  init(code: String, message: String, file: String = #fileID, line: UInt = #line, function: String = #function) {
    self.rpaCode = code
    self.rpaMessage = message
    super.init(file: file, line: line, function: function)
  }

  override var code: String { rpaCode }
  override var reason: String { rpaMessage }
}

private struct RpaHeader {
  let version: UInt8
  let algorithmId: UInt8
  let keyId: Data
  let chunkSize: UInt32
  let fileSalt: Data
}

enum RpaCrypto {
  // MARK: URL handling

  private static func urlFor(_ uriOrPath: String) -> URL {
    if let url = URL(string: uriOrPath), url.scheme != nil {
      return url
    }
    return URL(fileURLWithPath: uriOrPath)
  }

  // MARK: Primitives

  private static func sha256(_ data: Data) -> Data {
    Data(SHA256.hash(data: data))
  }

  private static func computeKeyId(_ installKey: SymmetricKey) -> Data {
    let raw = installKey.withUnsafeBytes { Data($0) }
    return sha256(raw).prefix(RpaConst.keyIdLen)
  }

  private static func deriveFileKey(installKey: SymmetricKey, fileSalt: Data) -> SymmetricKey {
    HKDF<SHA256>.deriveKey(
      inputKeyMaterial: installKey,
      salt: fileSalt,
      info: Data("RPA1-file-key".utf8),
      outputByteCount: 32
    )
  }

  private static func beBytes(_ value: UInt32) -> [UInt8] {
    [UInt8((value >> 24) & 0xff), UInt8((value >> 16) & 0xff), UInt8((value >> 8) & 0xff), UInt8(value & 0xff)]
  }

  private static func readBeUInt32(_ bytes: [UInt8], _ offset: Int) -> UInt32 {
    (UInt32(bytes[offset]) << 24) | (UInt32(bytes[offset + 1]) << 16) | (UInt32(bytes[offset + 2]) << 8)
      | UInt32(bytes[offset + 3])
  }

  private static func nonceFor(fileSalt: Data, index: UInt32) throws -> AES.GCM.Nonce {
    var bytes = beBytes(index)
    bytes.append(contentsOf: fileSalt.suffix(8))
    return try AES.GCM.Nonce(data: Data(bytes))
  }

  private static func aadFor(headerHash: Data, index: UInt32, isFinal: Bool) -> Data {
    var out = headerHash
    out.append(contentsOf: beBytes(index))
    out.append(isFinal ? 1 : 0)
    return out
  }

  private static func encodeHeader(keyId: Data, chunkSize: UInt32, fileSalt: Data) -> Data {
    var out = Data()
    out.append(contentsOf: RpaConst.magic)
    out.append(RpaConst.formatVersion)
    out.append(RpaConst.algorithmAes256Gcm)
    out.append(keyId)
    out.append(contentsOf: beBytes(chunkSize))
    out.append(fileSalt)
    return out
  }

  private static func decodeHeader(_ data: Data) throws -> RpaHeader {
    guard data.count >= RpaConst.headerLen else {
      throw RpaError(code: "E_RPA1_TRUNCATED", message: "Header is \(data.count) bytes, need \(RpaConst.headerLen)")
    }
    let bytes = [UInt8](data.prefix(RpaConst.headerLen))
    guard Array(bytes[0..<4]) == RpaConst.magic else {
      throw RpaError(code: "E_RPA1_BAD_MAGIC", message: "Not an RPA1 file (bad magic bytes)")
    }
    let version = bytes[4]
    guard version == RpaConst.formatVersion else {
      throw RpaError(code: "E_RPA1_UNSUPPORTED_VERSION", message: "Unsupported RPA1 version \(version)")
    }
    let algorithmId = bytes[5]
    guard algorithmId == RpaConst.algorithmAes256Gcm else {
      throw RpaError(code: "E_RPA1_UNSUPPORTED_ALGORITHM", message: "Unsupported algorithm id \(algorithmId)")
    }
    let keyId = Data(bytes[6..<(6 + RpaConst.keyIdLen)])
    let chunkSizeOffset = 6 + RpaConst.keyIdLen
    let chunkSize = readBeUInt32(bytes, chunkSizeOffset)
    let saltOffset = chunkSizeOffset + 4
    let fileSalt = Data(bytes[saltOffset..<(saltOffset + RpaConst.fileSaltLen)])
    return RpaHeader(version: version, algorithmId: algorithmId, keyId: keyId, chunkSize: chunkSize, fileSalt: fileSalt)
  }

  /**
   * The chunk-boundary rule — must exactly match `rpa1Format.ts`'s `planNextChunk` and
   * the reference codec. `remainingBytes` is the count of on-disk bytes not yet
   * consumed after the header (encrypt: derived from the known plaintext size;
   * decrypt: derived from the known ciphertext-region size). A record is final exactly
   * when it could not possibly be followed by another complete record.
   */
  private static func planNextChunk(remainingBytes: Int64, chunkSize: UInt32) throws -> (isFinal: Bool, dataLen: Int) {
    let fullRecord = Int64(chunkSize) + Int64(RpaConst.chunkOverhead)
    if remainingBytes <= fullRecord {
      let dataLen = remainingBytes - Int64(RpaConst.chunkOverhead)
      guard dataLen >= 0 else {
        throw RpaError(
          code: "E_RPA1_TRUNCATED",
          message: "Final record too short: \(remainingBytes) bytes left, need at least \(RpaConst.chunkOverhead)"
        )
      }
      return (true, Int(dataLen))
    }
    return (false, Int(chunkSize))
  }

  // MARK: File I/O helpers

  private static func readExactly(_ handle: FileHandle, count: Int, shortReadCode: String) throws -> Data {
    guard count > 0 else { return Data() }
    guard let data = try handle.read(upToCount: count), data.count == count else {
      throw RpaError(code: shortReadCode, message: "Expected \(count) bytes, got fewer")
    }
    return data
  }

  private static func fileSize(_ url: URL) throws -> Int64 {
    let attrs = try FileManager.default.attributesOfItem(atPath: url.path)
    guard let size = attrs[.size] as? Int64 ?? (attrs[.size] as? NSNumber)?.int64Value else {
      throw RpaError(code: "E_RPA1_IO", message: "Could not read file size")
    }
    return size
  }

  // MARK: Public operations

  static func generateInstallKeyBase64() throws -> String {
    var bytes = [UInt8](repeating: 0, count: 32)
    let status = SecRandomCopyBytes(kSecRandomDefault, 32, &bytes)
    guard status == errSecSuccess else {
      throw RpaError(code: "E_RPA1_IO", message: "Secure random generation failed (status \(status))")
    }
    return Data(bytes).base64EncodedString()
  }

  static func encryptFile(srcUri: String, dstUri: String, installKeyBase64: String, chunkSize: UInt32) throws -> [String: Any] {
    guard let installKeyData = Data(base64Encoded: installKeyBase64), installKeyData.count == 32 else {
      throw RpaError(code: "E_RPA1_IO", message: "installKeyBase64 must decode to exactly 32 bytes")
    }
    let effectiveChunkSize = chunkSize > 0 ? chunkSize : RpaConst.defaultChunkSize
    let installKey = SymmetricKey(data: installKeyData)
    let srcURL = urlFor(srcUri)
    let dstURL = urlFor(dstUri)
    let partURL = dstURL.appendingPathExtension("part")

    let plaintextSize = try fileSize(srcURL)

    var fileSaltBytes = [UInt8](repeating: 0, count: RpaConst.fileSaltLen)
    guard SecRandomCopyBytes(kSecRandomDefault, RpaConst.fileSaltLen, &fileSaltBytes) == errSecSuccess else {
      throw RpaError(code: "E_RPA1_IO", message: "Secure random generation failed for file salt")
    }
    let fileSalt = Data(fileSaltBytes)
    let keyId = computeKeyId(installKey)
    let header = encodeHeader(keyId: keyId, chunkSize: effectiveChunkSize, fileSalt: fileSalt)
    let headerHash = sha256(header)
    let fileKey = deriveFileKey(installKey: installKey, fileSalt: fileSalt)

    FileManager.default.createFile(atPath: partURL.path, contents: nil)
    guard let readHandle = FileHandle(forReadingAtPath: srcURL.path) else {
      throw RpaError(code: "E_RPA1_IO", message: "Could not open source file for reading")
    }
    guard let writeHandle = FileHandle(forWritingAtPath: partURL.path) else {
      throw RpaError(code: "E_RPA1_IO", message: "Could not open .part file for writing")
    }
    defer {
      try? readHandle.close()
      try? writeHandle.close()
    }

    writeHandle.write(header)

    var bytesRead: Int64 = 0
    var chunkIndex: UInt32 = 0
    while true {
      let remaining = plaintextSize - bytesRead
      let take = min(Int64(effectiveChunkSize), remaining)
      let isFinal = bytesRead + take == plaintextSize
      let chunkPlaintext = try readExactly(readHandle, count: Int(take), shortReadCode: "E_RPA1_IO")

      let nonce = try nonceFor(fileSalt: fileSalt, index: chunkIndex)
      let aad = aadFor(headerHash: headerHash, index: chunkIndex, isFinal: isFinal)
      let sealed = try AES.GCM.seal(chunkPlaintext, using: fileKey, nonce: nonce, authenticating: aad)

      writeHandle.write(Data(sealed.nonce))
      writeHandle.write(sealed.ciphertext)
      writeHandle.write(sealed.tag)

      bytesRead += take
      chunkIndex += 1
      if isFinal { break }
    }

    try readHandle.close()
    try writeHandle.close()

    // Atomic .part -> final rename: a crash/kill any time before this line leaves only
    // a stray `.part` file, never a half-written file at `dstURL` that decrypt could
    // ever be pointed at.
    if FileManager.default.fileExists(atPath: dstURL.path) {
      try FileManager.default.removeItem(at: dstURL)
    }
    try FileManager.default.moveItem(at: partURL, to: dstURL)

    return [
      "keyIdHex": keyId.map { String(format: "%02x", $0) }.joined(),
      "chunkSize": Int(effectiveChunkSize),
      "totalChunks": Int(chunkIndex),
      "plaintextSize": Int(plaintextSize),
    ]
  }

  static func decryptFile(srcUri: String, dstUri: String, installKeyBase64: String) throws -> [String: Any] {
    guard let installKeyData = Data(base64Encoded: installKeyBase64), installKeyData.count == 32 else {
      throw RpaError(code: "E_RPA1_IO", message: "installKeyBase64 must decode to exactly 32 bytes")
    }
    let installKey = SymmetricKey(data: installKeyData)
    let srcURL = urlFor(srcUri)
    let dstURL = urlFor(dstUri)
    let partURL = dstURL.appendingPathExtension("part")

    guard let readHandle = FileHandle(forReadingAtPath: srcURL.path) else {
      throw RpaError(code: "E_RPA1_IO", message: "Could not open encrypted file for reading")
    }
    defer { try? readHandle.close() }

    let totalSize = try fileSize(srcURL)
    guard totalSize >= Int64(RpaConst.headerLen) else {
      throw RpaError(code: "E_RPA1_TRUNCATED", message: "File is \(totalSize) bytes, need at least the header")
    }

    let headerData = try readExactly(readHandle, count: RpaConst.headerLen, shortReadCode: "E_RPA1_TRUNCATED")
    let header = try decodeHeader(headerData) // throws E_RPA1_BAD_MAGIC / E_RPA1_UNSUPPORTED_*
    let headerHash = sha256(headerData)

    let expectedKeyId = computeKeyId(installKey)
    guard header.keyId == expectedKeyId else {
      throw RpaError(
        code: "E_RPA1_KEY_MISMATCH",
        message: "This file was encrypted with a different install key (reinstall or key loss)"
      )
    }
    let fileKey = deriveFileKey(installKey: installKey, fileSalt: header.fileSalt)

    FileManager.default.createFile(atPath: partURL.path, contents: nil)
    guard let writeHandle = FileHandle(forWritingAtPath: partURL.path) else {
      throw RpaError(code: "E_RPA1_IO", message: "Could not open .part file for writing")
    }
    defer { try? writeHandle.close() }

    var bytesConsumed: Int64 = Int64(RpaConst.headerLen)
    var chunkIndex: UInt32 = 0
    var sawFinal = false
    var plaintextSize: Int64 = 0

    while bytesConsumed < totalSize {
      let remaining = totalSize - bytesConsumed
      let (isFinal, cipherLen) = try planNextChunk(remainingBytes: remaining, chunkSize: header.chunkSize)
      let recordLen = Int64(RpaConst.nonceLen) + Int64(cipherLen) + Int64(RpaConst.tagLen)
      guard bytesConsumed + recordLen <= totalSize else {
        throw RpaError(code: "E_RPA1_TRUNCATED", message: "Chunk record runs past end of file")
      }

      let nonceData = try readExactly(readHandle, count: RpaConst.nonceLen, shortReadCode: "E_RPA1_TRUNCATED")
      let ciphertext = try readExactly(readHandle, count: cipherLen, shortReadCode: "E_RPA1_TRUNCATED")
      let tag = try readExactly(readHandle, count: RpaConst.tagLen, shortReadCode: "E_RPA1_TRUNCATED")

      let nonce: AES.GCM.Nonce
      do {
        nonce = try AES.GCM.Nonce(data: nonceData)
      } catch {
        throw RpaError(code: "E_RPA1_TRUNCATED", message: "Malformed nonce")
      }
      let aad = aadFor(headerHash: headerHash, index: chunkIndex, isFinal: isFinal)

      let plaintext: Data
      do {
        let sealedBox = try AES.GCM.SealedBox(nonce: nonce, ciphertext: ciphertext, tag: tag)
        plaintext = try AES.GCM.open(sealedBox, using: fileKey, authenticating: aad)
      } catch {
        throw RpaError(code: "E_RPA1_AUTH_FAILED", message: "GCM authentication failed at chunk \(chunkIndex)")
      }

      writeHandle.write(plaintext)
      plaintextSize += Int64(plaintext.count)

      bytesConsumed += recordLen
      chunkIndex += 1
      sawFinal = isFinal
    }

    guard sawFinal else {
      throw RpaError(code: "E_RPA1_TRUNCATED", message: "File ends before a final chunk was written")
    }

    try readHandle.close()
    try writeHandle.close()

    if FileManager.default.fileExists(atPath: dstURL.path) {
      try FileManager.default.removeItem(at: dstURL)
    }
    try FileManager.default.moveItem(at: partURL, to: dstURL)

    return ["plaintextSize": Int(plaintextSize)]
  }

  /**
   * Excludes the file at `uri` from iCloud/iTunes/Finder backup (`NSURLIsExcludedFromBackupKey`),
   * per the architect's writeup's mitigation for path A (decrypt-to-temp-file playback):
   * a downloaded/decrypted file should never round-trip through a device backup. Returns
   * `false` (not a throw) if the resource value couldn't be set on an existing file —
   * missing/unreadable file paths still throw, since that is a genuine caller error.
   */
  static func excludeFromBackup(uri: String) throws -> Bool {
    var url = urlFor(uri)
    guard FileManager.default.fileExists(atPath: url.path) else {
      throw RpaError(code: "E_RPA1_IO", message: "No file at \(url.path) to exclude from backup")
    }
    var resourceValues = URLResourceValues()
    resourceValues.isExcludedFromBackup = true
    do {
      try url.setResourceValues(resourceValues)
      return true
    } catch {
      return false
    }
  }

  static func readHeaderInfo(uri: String) throws -> [String: Any] {
    let url = urlFor(uri)
    guard let handle = FileHandle(forReadingAtPath: url.path) else {
      throw RpaError(code: "E_RPA1_IO", message: "Could not open file for reading")
    }
    defer { try? handle.close() }
    let headerData = try readExactly(handle, count: RpaConst.headerLen, shortReadCode: "E_RPA1_TRUNCATED")
    let header = try decodeHeader(headerData)
    return [
      "version": Int(header.version),
      "algorithmId": Int(header.algorithmId),
      "keyIdHex": header.keyId.map { String(format: "%02x", $0) }.joined(),
      "chunkSize": Int(header.chunkSize),
    ]
  }
}
