/**
 * The name other viewers see on a comment, previewed locally while the user types. Same
 * rule as the server's `public_display_name`: the first token, then the first character
 * of the last token and a period ("Nii Kwame Okai" -> "Nii O."); a single token is
 * shown as-is; blank is `null`. The server's value is authoritative once saved.
 */
export function previewDisplayName(fullName: string | null | undefined): string | null {
  const tokens = (fullName ?? '').split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  if (tokens.length === 1) return tokens[0]!;
  return `${tokens[0]} ${Array.from(tokens[tokens.length - 1]!)[0]}.`;
}
