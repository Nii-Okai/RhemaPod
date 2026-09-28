package expo.modules.rpacrypto

import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.URI
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * RPA1 — chunked AES-256-GCM file encryption, `javax.crypto` only (no OpenSSL, no
 * third-party crypto). Plan W4.5 / GATE M9 (see `status.md`, architect entry
 * 2026-09-26T12:08:20Z, locked by Isaac's GATE M9 crossing 2026-09-27T20:05:00Z).
 *
 * Mirrors `ios/RpaCryptoModule.swift` line-for-line and both mirror the spec encoded
 * in `mobile/lib/crypto/rpa1Format.ts` / `mobile/lib/crypto/testSupport/rpa1ReferenceCodec.ts`
 * (Jest-executable there; this file is NOT executable in this sandbox — no Gradle/Kotlin
 * toolchain available, see the mobile-developer status entry for the exact gap). If you
 * change the byte layout here, change it in all three places and re-run `rpa1.test.ts`.
 *
 * Streams file-to-file via plain sequential `FileInputStream`/`FileOutputStream`, one
 * chunk (default 256 KiB plaintext) at a time — constant memory regardless of file size.
 */
class RpaCryptoModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("RpaCrypto")

    AsyncFunction("generateInstallKeyBase64") {
      RpaCrypto.generateInstallKeyBase64()
    }

    AsyncFunction("encryptFile") { srcUri: String, dstUri: String, installKeyBase64: String, chunkSize: Double ->
      RpaCrypto.encryptFile(srcUri, dstUri, installKeyBase64, chunkSize.toInt())
    }

    AsyncFunction("decryptFile") { srcUri: String, dstUri: String, installKeyBase64: String ->
      RpaCrypto.decryptFile(srcUri, dstUri, installKeyBase64)
    }

    AsyncFunction("readHeaderInfo") { uri: String ->
      RpaCrypto.readHeaderInfo(uri)
    }

    AsyncFunction("excludeFromBackup") { uri: String ->
      RpaCrypto.excludeFromBackup(uri)
    }
  }
}

/**
 * Thrown with a stable `code` the JS side switches on (see `modules/rpa-crypto/index.ts`).
 * `CodedException`'s 3-arg constructor (`code`, `message`, `cause`) sets its own `.code`
 * getter directly — verified against the real source shipped in this repo's
 * `node_modules/expo-modules-core/android/.../CodedException.kt`, not guessed from memory.
 * Expo's Kotlin module runtime catches any thrown `CodedException` from inside an
 * `AsyncFunction` body and rejects the JS promise with `{ code, message }`, which is what
 * `modules/rpa-crypto/index.ts` reads via `error.code`.
 */
class RpaException(code: String, message: String) : CodedException(code, message, null)

private object RpaConst {
  val MAGIC = byteArrayOf(0x52, 0x50, 0x41, 0x31) // ASCII "RPA1"
  const val FORMAT_VERSION: Int = 1
  const val ALGORITHM_AES_256_GCM: Int = 1
  const val KEY_ID_LEN = 8
  const val FILE_SALT_LEN = 16
  const val HEADER_LEN = 4 + 1 + 1 + KEY_ID_LEN + 4 + FILE_SALT_LEN // 34
  const val NONCE_LEN = 12
  const val TAG_LEN = 16
  const val CHUNK_OVERHEAD = NONCE_LEN + TAG_LEN // 28
  const val DEFAULT_CHUNK_SIZE = 256 * 1024
}

private data class RpaHeader(
  val version: Int,
  val algorithmId: Int,
  val keyId: ByteArray,
  val chunkSize: Int,
  val fileSalt: ByteArray,
)

object RpaCrypto {
  private val secureRandom = SecureRandom()

  // MARK: path handling — JS passes `file://...` URIs (from expo-file-system); also
  // accept a bare filesystem path for robustness.
  private fun fileFor(uriOrPath: String): File {
    return if (uriOrPath.startsWith("file:")) {
      File(URI(uriOrPath))
    } else {
      File(uriOrPath)
    }
  }

  // MARK: primitives

  private fun sha256(data: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(data)

  private fun hmacSha256(key: ByteArray, data: ByteArray): ByteArray {
    val mac = Mac.getInstance("HmacSHA256")
    mac.init(SecretKeySpec(key, "HmacSHA256"))
    return mac.doFinal(data)
  }

  /** HKDF-SHA256 (RFC 5869), extract-then-expand, one block (<=32 bytes) — all this format needs. */
  private fun hkdfSha256(ikm: ByteArray, salt: ByteArray, info: String, length: Int): ByteArray {
    require(length <= 32) { "This implementation only supports length <= 32" }
    val prk = hmacSha256(salt, ikm)
    val infoBytes = info.toByteArray(Charsets.UTF_8)
    val t1 = hmacSha256(prk, infoBytes + byteArrayOf(0x01))
    return t1.copyOf(length)
  }

  private fun computeKeyId(installKey: ByteArray): ByteArray = sha256(installKey).copyOf(RpaConst.KEY_ID_LEN)

  private fun deriveFileKey(installKey: ByteArray, fileSalt: ByteArray): ByteArray =
    hkdfSha256(installKey, fileSalt, "RPA1-file-key", 32)

  private fun beBytes(value: Int): ByteArray =
    byteArrayOf(
      ((value ushr 24) and 0xff).toByte(),
      ((value ushr 16) and 0xff).toByte(),
      ((value ushr 8) and 0xff).toByte(),
      (value and 0xff).toByte(),
    )

  private fun readBeInt(bytes: ByteArray, offset: Int): Int =
    ((bytes[offset].toInt() and 0xff) shl 24) or
      ((bytes[offset + 1].toInt() and 0xff) shl 16) or
      ((bytes[offset + 2].toInt() and 0xff) shl 8) or
      (bytes[offset + 3].toInt() and 0xff)

  private fun nonceFor(fileSalt: ByteArray, index: Int): ByteArray =
    beBytes(index) + fileSalt.copyOfRange(RpaConst.FILE_SALT_LEN - 8, RpaConst.FILE_SALT_LEN)

  private fun aadFor(headerHash: ByteArray, index: Int, isFinal: Boolean): ByteArray =
    headerHash + beBytes(index) + byteArrayOf(if (isFinal) 1 else 0)

  private fun encodeHeader(keyId: ByteArray, chunkSize: Int, fileSalt: ByteArray): ByteArray {
    val out = ByteArray(RpaConst.HEADER_LEN)
    var offset = 0
    RpaConst.MAGIC.copyInto(out, offset); offset += 4
    out[offset] = RpaConst.FORMAT_VERSION.toByte(); offset += 1
    out[offset] = RpaConst.ALGORITHM_AES_256_GCM.toByte(); offset += 1
    keyId.copyInto(out, offset); offset += RpaConst.KEY_ID_LEN
    beBytes(chunkSize).copyInto(out, offset); offset += 4
    fileSalt.copyInto(out, offset)
    return out
  }

  private fun decodeHeader(data: ByteArray): RpaHeader {
    if (data.size < RpaConst.HEADER_LEN) {
      throw RpaException("E_RPA1_TRUNCATED", "Header is ${data.size} bytes, need ${RpaConst.HEADER_LEN}")
    }
    for (i in 0 until 4) {
      if (data[i] != RpaConst.MAGIC[i]) {
        throw RpaException("E_RPA1_BAD_MAGIC", "Not an RPA1 file (bad magic bytes)")
      }
    }
    val version = data[4].toInt() and 0xff
    if (version != RpaConst.FORMAT_VERSION) {
      throw RpaException("E_RPA1_UNSUPPORTED_VERSION", "Unsupported RPA1 version $version")
    }
    val algorithmId = data[5].toInt() and 0xff
    if (algorithmId != RpaConst.ALGORITHM_AES_256_GCM) {
      throw RpaException("E_RPA1_UNSUPPORTED_ALGORITHM", "Unsupported algorithm id $algorithmId")
    }
    val keyId = data.copyOfRange(6, 6 + RpaConst.KEY_ID_LEN)
    val chunkSizeOffset = 6 + RpaConst.KEY_ID_LEN
    val chunkSize = readBeInt(data, chunkSizeOffset)
    val saltOffset = chunkSizeOffset + 4
    val fileSalt = data.copyOfRange(saltOffset, saltOffset + RpaConst.FILE_SALT_LEN)
    return RpaHeader(version, algorithmId, keyId, chunkSize, fileSalt)
  }

  /** Must exactly match `rpa1Format.ts`'s `planNextChunk` and the reference codec — see that file's docstring. */
  private fun planNextChunk(remainingBytes: Long, chunkSize: Int): Pair<Boolean, Int> {
    val fullRecord = chunkSize.toLong() + RpaConst.CHUNK_OVERHEAD
    if (remainingBytes <= fullRecord) {
      val dataLen = remainingBytes - RpaConst.CHUNK_OVERHEAD
      if (dataLen < 0) {
        throw RpaException(
          "E_RPA1_TRUNCATED",
          "Final record too short: $remainingBytes bytes left, need at least ${RpaConst.CHUNK_OVERHEAD}",
        )
      }
      return Pair(true, dataLen.toInt())
    }
    return Pair(false, chunkSize)
  }

  // MARK: file I/O helpers

  private fun readExactly(stream: FileInputStream, count: Int, shortReadCode: String): ByteArray {
    if (count == 0) return ByteArray(0)
    val out = ByteArray(count)
    var read = 0
    while (read < count) {
      val n = stream.read(out, read, count - read)
      if (n < 0) throw RpaException(shortReadCode, "Expected $count bytes, got $read")
      read += n
    }
    return out
  }

  private fun aesGcmSeal(key: ByteArray, nonce: ByteArray, aad: ByteArray, plaintext: ByteArray): Pair<ByteArray, ByteArray> {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(RpaConst.TAG_LEN * 8, nonce))
    cipher.updateAAD(aad)
    val out = cipher.doFinal(plaintext) // ciphertext || tag, tag is the trailing TAG_LEN bytes
    val ciphertext = out.copyOfRange(0, out.size - RpaConst.TAG_LEN)
    val tag = out.copyOfRange(out.size - RpaConst.TAG_LEN, out.size)
    return Pair(ciphertext, tag)
  }

  /** Throws (via `AEADBadTagException`, a `javax.crypto` subclass of `GeneralSecurityException`) on tamper/wrong key/wrong AAD. */
  private fun aesGcmOpen(key: ByteArray, nonce: ByteArray, aad: ByteArray, ciphertext: ByteArray, tag: ByteArray): ByteArray {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(RpaConst.TAG_LEN * 8, nonce))
    cipher.updateAAD(aad)
    return cipher.doFinal(ciphertext + tag)
  }

  // MARK: public operations

  fun generateInstallKeyBase64(): String {
    val bytes = ByteArray(32)
    secureRandom.nextBytes(bytes)
    return android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
  }

  fun encryptFile(srcUri: String, dstUri: String, installKeyBase64: String, chunkSize: Int): Map<String, Any> {
    val installKey = android.util.Base64.decode(installKeyBase64, android.util.Base64.NO_WRAP)
    if (installKey.size != 32) {
      throw RpaException("E_RPA1_IO", "installKeyBase64 must decode to exactly 32 bytes")
    }
    val effectiveChunkSize = if (chunkSize > 0) chunkSize else RpaConst.DEFAULT_CHUNK_SIZE

    val srcFile = fileFor(srcUri)
    val dstFile = fileFor(dstUri)
    val partFile = File(dstFile.path + ".part")

    val plaintextSize = srcFile.length()

    val fileSalt = ByteArray(RpaConst.FILE_SALT_LEN).also { secureRandom.nextBytes(it) }
    val keyId = computeKeyId(installKey)
    val header = encodeHeader(keyId, effectiveChunkSize, fileSalt)
    val headerHash = sha256(header)
    val fileKey = deriveFileKey(installKey, fileSalt)

    // Deliberately not `.use { }` with a non-local `return@use` from inside a nested
    // loop — kept as plain try/finally so the control flow (one `return` at the very
    // end, after both streams are guaranteed closed) is easy to verify by reading, with
    // no Kotlin compiler available in this sandbox to catch a subtler mistake (see the
    // mobile-developer status entry's verification-gap note).
    var chunkIndex = 0
    val readStream = FileInputStream(srcFile)
    try {
      val writeStream = FileOutputStream(partFile)
      try {
        writeStream.write(header)

        var bytesRead = 0L
        var isFinal = false
        while (!isFinal) {
          val remaining = plaintextSize - bytesRead
          val take = minOf(effectiveChunkSize.toLong(), remaining).toInt()
          isFinal = bytesRead + take == plaintextSize
          val chunkPlaintext = readExactly(readStream, take, "E_RPA1_IO")

          val nonce = nonceFor(fileSalt, chunkIndex)
          val aad = aadFor(headerHash, chunkIndex, isFinal)
          val (ciphertext, tag) = aesGcmSeal(fileKey, nonce, aad, chunkPlaintext)

          writeStream.write(nonce)
          writeStream.write(ciphertext)
          writeStream.write(tag)

          bytesRead += take
          chunkIndex += 1
        }
      } finally {
        writeStream.close()
      }
    } finally {
      readStream.close()
    }

    // Atomic .part -> final rename: a crash/kill any time before this line leaves only
    // a stray `.part` file, never a half-written file at `dstFile` that decrypt could
    // ever be pointed at.
    if (dstFile.exists()) dstFile.delete()
    if (!partFile.renameTo(dstFile)) {
      throw RpaException("E_RPA1_IO", "Could not rename .part to final destination")
    }

    return mapOf(
      "keyIdHex" to keyId.joinToString("") { "%02x".format(it) },
      "chunkSize" to effectiveChunkSize,
      "totalChunks" to chunkIndex,
      "plaintextSize" to plaintextSize.toInt(),
    )
  }

  fun decryptFile(srcUri: String, dstUri: String, installKeyBase64: String): Map<String, Any> {
    val installKey = android.util.Base64.decode(installKeyBase64, android.util.Base64.NO_WRAP)
    if (installKey.size != 32) {
      throw RpaException("E_RPA1_IO", "installKeyBase64 must decode to exactly 32 bytes")
    }
    val srcFile = fileFor(srcUri)
    val dstFile = fileFor(dstUri)
    val partFile = File(dstFile.path + ".part")

    val totalSize = srcFile.length()
    if (totalSize < RpaConst.HEADER_LEN) {
      throw RpaException("E_RPA1_TRUNCATED", "File is $totalSize bytes, need at least the header")
    }

    var plaintextSize = 0L

    FileInputStream(srcFile).use { readStream ->
      val headerData = readExactly(readStream, RpaConst.HEADER_LEN, "E_RPA1_TRUNCATED")
      val header = decodeHeader(headerData) // throws E_RPA1_BAD_MAGIC / E_RPA1_UNSUPPORTED_*
      val headerHash = sha256(headerData)

      val expectedKeyId = computeKeyId(installKey)
      if (!header.keyId.contentEquals(expectedKeyId)) {
        throw RpaException(
          "E_RPA1_KEY_MISMATCH",
          "This file was encrypted with a different install key (reinstall or key loss)",
        )
      }
      val fileKey = deriveFileKey(installKey, header.fileSalt)

      FileOutputStream(partFile).use { writeStream ->
        var bytesConsumed = RpaConst.HEADER_LEN.toLong()
        var chunkIndex = 0
        var sawFinal = false

        while (bytesConsumed < totalSize) {
          val remaining = totalSize - bytesConsumed
          val (isFinal, cipherLen) = planNextChunk(remaining, header.chunkSize)
          val recordLen = RpaConst.NONCE_LEN.toLong() + cipherLen + RpaConst.TAG_LEN
          if (bytesConsumed + recordLen > totalSize) {
            throw RpaException("E_RPA1_TRUNCATED", "Chunk record runs past end of file")
          }

          val nonce = readExactly(readStream, RpaConst.NONCE_LEN, "E_RPA1_TRUNCATED")
          val ciphertext = readExactly(readStream, cipherLen, "E_RPA1_TRUNCATED")
          val tag = readExactly(readStream, RpaConst.TAG_LEN, "E_RPA1_TRUNCATED")
          val aad = aadFor(headerHash, chunkIndex, isFinal)

          val plaintext = try {
            aesGcmOpen(fileKey, nonce, aad, ciphertext, tag)
          } catch (e: Exception) {
            throw RpaException("E_RPA1_AUTH_FAILED", "GCM authentication failed at chunk $chunkIndex")
          }

          writeStream.write(plaintext)
          plaintextSize += plaintext.size

          bytesConsumed += recordLen
          chunkIndex += 1
          sawFinal = isFinal
        }

        if (!sawFinal) {
          throw RpaException("E_RPA1_TRUNCATED", "File ends before a final chunk was written")
        }
      }
    }

    if (dstFile.exists()) dstFile.delete()
    if (!partFile.renameTo(dstFile)) {
      throw RpaException("E_RPA1_IO", "Could not rename .part to final destination")
    }

    return mapOf("plaintextSize" to plaintextSize.toInt())
  }

  /**
   * Android has no per-file backup-exclusion API equivalent to iOS's
   * `NSURLIsExcludedFromBackupKey` — backup scope on Android is manifest-level
   * (`android:allowBackup`/`fullBackupContent`), not something a file can opt out of at
   * runtime. Always returns `false` (never throws for this reason) — the architect's
   * writeup already covers why this is acceptable: Android 10+ app-private storage is
   * FBE-encrypted regardless, so this call is advisory-only on iOS and a documented no-op
   * here, not a required mitigation on this platform.
   */
  fun excludeFromBackup(uri: String): Boolean {
    val file = fileFor(uri)
    if (!file.exists()) {
      throw RpaException("E_RPA1_IO", "No file at ${file.path} to exclude from backup")
    }
    return false
  }

  fun readHeaderInfo(uri: String): Map<String, Any> {
    val file = fileFor(uri)
    FileInputStream(file).use { stream ->
      val headerData = readExactly(stream, RpaConst.HEADER_LEN, "E_RPA1_TRUNCATED")
      val header = decodeHeader(headerData)
      return mapOf(
        "version" to header.version,
        "algorithmId" to header.algorithmId,
        "keyIdHex" to header.keyId.joinToString("") { "%02x".format(it) },
        "chunkSize" to header.chunkSize,
      )
    }
  }
}
