#!/bin/bash
# Crop PDF selection-system E2E — trusted CDP mouse drags via agent-browser.
# Re-anchors to the crop container before every test (the Reset click scrolls
# the page). Content px == PDF pt (1:1) on the 612x792 test page.
# Sleeps between CDP inputs are MANDATORY: back-to-back mousemove inputs get
# coalesced by Chromium (final move dropped) and React needs a beat to flush
# state before the next drag's pointerdown hit-tests.
AB="agent-browser"

origin() {
  $AB eval "(() => { const el = document.querySelector('.cursor-crosshair'); el.scrollIntoView({ block: 'center', behavior: 'instant' }); const r0 = el.getBoundingClientRect(); if (r0.top < 84) window.scrollBy(0, Math.round(r0.top - 90)); return 1 })()" >/dev/null
  sleep 0.3
  local pair=$($AB eval "(() => { const el = document.querySelector('.cursor-crosshair'); const r = el.getBoundingClientRect(); return Math.round(r.left + el.clientLeft) + ' ' + Math.round(r.top + el.clientTop) })()" | tr -d '"')
  OX=${pair% *}; OY=${pair#* }
}

mv() { $AB mouse move $((OX + $1)) $((OY + $2)) >/dev/null; sleep 0.12; }
down() { $AB mouse down left >/dev/null; sleep 0.12; }
up() { $AB mouse up left >/dev/null; sleep 0.35; }
drag() { mv $1 $2; down; if [ $# -gt 4 ]; then mv $5 $6; fi; mv $3 $4; sleep 0.15; up; }

sel() {
  $AB eval "(() => { const el = document.querySelector('.cursor-crosshair'); const b = el && el.querySelector('div.border-2.border-primary'); if (!b) return 'null'; const p = (s) => parseFloat(s); return JSON.stringify({ x: p(b.style.left), y: p(b.style.top), w: p(b.style.width), h: p(b.style.height) }) })()" | tr -d '"\'
}

reset() { $AB find text "Reset crop" click >/dev/null 2>&1; sleep 0.25; origin; }
fresh() { reset; drag 100 100 300 260 200 180; }

check() {
  local got=$(sel)
  if [ "$got" = "$2" ]; then echo "PASS  $1  ($got)"; else echo "FAIL  $1  got=$got want=$2"; fi
}
J() { echo "{\"x\":$1,\"y\":$2,\"w\":$3,\"h\":$4}"; }

echo "== Crop PDF selection tests =="
origin

# T1 — draw a fresh selection
drag 100 100 300 260 200 180
check "T1 draw -> 100,100 200x160" "$(J 100 100 200 160)"

# T2 — THE bug: n mid-handle swiped diagonally; width must NEVER change
fresh
drag 200 100 260 130 230 115
check "T2 n-handle diag: w stays 200, top follows dy" "$(J 100 130 200 130)"

# T3a — e mid-handle vertical-only swipe: total no-op
fresh
drag 300 180 300 240
check "T3a e-handle vertical-only no-op" "$(J 100 100 200 160)"

# T3b — e mid-handle horizontal: width only
fresh
drag 300 180 340 180 320 200
check "T3b e-handle dx: w 200->240, h fixed" "$(J 100 100 240 160)"

# T4 — SE corner: both axes, NW anchored
fresh
drag 300 260 360 320 330 290
check "T4 SE corner: NW anchored" "$(J 100 100 260 220)"

# T5 — flush left edge draw + w-handle resize (x=0 grab)
fresh
drag 0 100 200 260 100 180
check "T5 draw flush x=0" "$(J 0 100 200 160)"
drag 0 180 50 180 25 180
check "T5b flush w-handle resizes" "$(J 50 100 150 160)"

# T6 — move keeps dimensions
fresh
drag 200 180 250 220 225 200
check "T6 move keeps dims" "$(J 150 140 200 160)"

# T7 — e-handle dragged far past the w edge clamps at MIN_SIZE=20
fresh
drag 300 180 60 180 150 180
check "T7 e-drag past w-edge clamps at 20" "$(J 100 100 20 160)"

# T8 — flush right edge + e-handle grab at x=cw
fresh
drag 412 100 612 260 512 180
check "T8 draw flush right edge" "$(J 412 100 200 160)"
drag 612 180 562 180 587 180
check "T8b flush e-handle resizes" "$(J 412 100 150 160)"

# T9 — s mid-handle: bottom moves, width fixed
fresh
drag 200 260 260 300 230 280
check "T9 s-handle: bottom only" "$(J 100 100 200 200)"

# T10 — NW corner drag: left/top follow, SE anchored (300,260)
fresh
drag 100 100 60 140 80 120
check "T10 NW corner: SE anchored" "$(J 60 140 240 120)"

echo "== done =="
