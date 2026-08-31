"""Fix escape sequences in the meme-maker worker block of worker-source.ts.

The worker source is a plain template literal: escape sequences written with
single backslashes get consumed by the OUTER literal, so the emitted worker
code receives mangled tokens. Inside this block we need double backslashes:
  /\\s/g   -> /\\\\s/g   (else the worker replaces 's' chars, not whitespace)
  '\\n'    -> '\\\\n'    (else the emitted string literal spans a real newline -> SyntaxError)
  /\\./    -> /\\\\./    (else '.' matches any char)
Only the meme-maker block (between its header comment and the ICO helpers
header) is patched; other processors are left untouched.
"""

path = "src/lib/processing/worker-source.ts"
src = open(path, encoding="utf-8").read()

START = "/* ---- Meme Maker (caption editor)"
END = "/* ---- ICO encoding helpers"
si = src.index(START)
ei = src.index(END, si)
block = src[si:ei]

replacements = [
    (r"/\s/g", r"/\\s/g"),
    (r"split('\n')", r"split('\\n')"),
    (r"/\.jpe?g$/", r"/\\.jpe?g$/"),
    (r"/\.webp$/", r"/\\.webp$/"),
]
for old, new in replacements:
    count = block.count(old)
    block = block.replace(old, new)
    print(f"{old!r}: replaced {count}")

src = src[:si] + block + src[ei:]
open(path, "w", encoding="utf-8").write(src)
print("done")
