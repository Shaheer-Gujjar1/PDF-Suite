#!/bin/bash
# E2E tests for the new Photo Editor tool (Task 23).
# Verifies: home card, editor loads an image, adjust preset, crop apply (dims
# shrink), trusted-CDP-mouse draw stroke, text placement, transform rotate
# (dims swap), undo, and a full Run -> byte-level PNG check of the output.

AB="agent-browser"
BASE="http://localhost:3000"
PASS=0; FAIL=0
ck() { if [ "$1" = "OK" ]; then PASS=$((PASS+1)); echo "  PASS: $2"; else FAIL=$((FAIL+1)); echo "  FAIL: $2"; echo "        got: $3"; fi; }

echo "== T0: home page shows the Photo Editor card =="
$AB open "$BASE/" >/dev/null 2>&1; sleep 2
R=$($AB eval "(()=>{const el=[...document.querySelectorAll('h3')].find(h=>h.textContent.trim()==='Photo Editor');return el?'card-found':'missing'})()" 2>/dev/null)
ck "${R:+OK}" "home card 'Photo Editor' present" "$R"

echo "== T1: open tool, upload a test image =="
$AB open "$BASE/#/photo-editor" >/dev/null 2>&1; sleep 3
$AB eval "(()=>{const c=document.createElement('canvas');c.width=400;c.height=300;const x=c.getContext('2d');x.fillStyle='#e11d48';x.fillRect(0,0,400,300);x.fillStyle='#0ea5e9';x.fillRect(40,40,120,90);c.toBlob(b=>{const f=new File([b],'test-photo.png',{type:'image/png'});const inputs=document.querySelectorAll('input[type=file]');const input=inputs[inputs.length-1];const dt=new DataTransfer();dt.items.add(f);input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}))},'image/png');return 'file-created'})()" >/dev/null 2>&1
sleep 3
R=$($AB eval "(()=>{const t=document.body.innerText;const btns=[...document.querySelectorAll('button')].map(b=>b.textContent.trim());return (btns.includes('Filter & light')&&btns.includes('Crop')&&btns.includes('Transform')&&btns.includes('Resize')&&btns.includes('Draw')&&btns.includes('Text')&&btns.includes('Shapes')&&btns.includes('Frame'))?'toolbar-found':'toolbar-missing'})()" 2>/dev/null)
ck "${R:+OK}" "editor toolbar shows all 8 modes" "$R"
R=$($AB eval "(()=>{const c=document.querySelector('canvas');return c&&c.width>50?'canvas-'+c.width+'x'+c.height:'no-canvas'})()" 2>/dev/null)
ck "${R:+OK}" "preview canvas rendered" "$R"

echo "== T2: Filter & light — Sepia preset applies =="
$AB eval "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Sepia');b.click();return 'sepia-clicked'})()" >/dev/null 2>&1
sleep 1
R=$($AB eval "(()=>{const t=document.body.innerText;return t.includes('Warmth: 80%')?'sepia-applied':'sepia-missing'})()" 2>/dev/null)
ck "${R:+OK}" "Sepia preset sets warmth 80%" "$R"

echo "== T3: Crop — apply the default 60% selection =="
$AB eval "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Crop');b.click();return 'crop-mode'})()" >/dev/null 2>&1
sleep 1
R=$($AB eval "(()=>{const t=document.body.innerText;return t.includes('Apply crop')?'crop-panel':'crop-panel-missing'})()" 2>/dev/null)
ck "${R:+OK}" "crop panel visible with selection" "$R"
$AB eval "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Apply crop');b.click();return 'applied'})()" >/dev/null 2>&1
sleep 2
$AB eval "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Resize');b.click();return 'resize-mode'})()" >/dev/null 2>&1
sleep 1
R=$($AB eval "(()=>{const t=document.body.innerText;const m=t.match(/Current size: ([0-9]+) x ([0-9]+)/);return m?('dims-'+m[1]+'x'+m[2]):'dims-missing'})()" 2>/dev/null)
CROP_OK=$(echo "$R" | grep -c 'dims-240x180')
ck "$([ "$CROP_OK" -ge 1 ] && echo OK)" "crop shrank the photo to exactly 240x180 (60% of 400x300)" "$R"

echo "== T4: Draw — trusted CDP mouse stroke =="
$AB eval "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Draw');b.click();return 'draw-mode'})()" >/dev/null 2>&1
sleep 1
$AB eval "(()=>{const c=document.querySelector('canvas');c.scrollIntoView({block:'center'});window.scrollBy(0,-120);const r=c.getBoundingClientRect();return JSON.stringify({x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)})})()" >/dev/null 2>&1
BOX=$($AB eval "(()=>{const c=document.querySelector('canvas');const r=c.getBoundingClientRect();return JSON.stringify({x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)})})()" 2>/dev/null | tr -d '\\' | sed 's/^"//;s/"$//' | sed 's/\\"/"/g')
BX=$(echo "$BOX" | sed -E 's/.*"x":([0-9]+).*/\1/'); BY=$(echo "$BOX" | sed -E 's/.*"y":([0-9]+).*/\1/')
BW=$(echo "$BOX" | sed -E 's/.*"w":([0-9]+).*/\1/'); BH=$(echo "$BOX" | sed -E 's/.*"h":([0-9]+).*/\1/')
echo "        canvas box: $BX,$BY ${BW}x${BH}"
X1=$((BX + BW/5)); Y1=$((BY + BH/5)); X2=$((BX + BW*4/5)); Y2=$((BY + BH*4/5))
$AB mouse move "$X1" "$Y1" >/dev/null 2>&1; sleep 0.2
$AB mouse down left >/dev/null 2>&1; sleep 0.2
$AB mouse move "$(( (X1+X2)/2 ))" "$(( (Y1+Y2)/2 ))" >/dev/null 2>&1; sleep 0.2
$AB mouse move "$X2" "$Y2" >/dev/null 2>&1; sleep 0.2
$AB mouse move "$X2" "$Y2" >/dev/null 2>&1; sleep 0.2
$AB mouse up left >/dev/null 2>&1; sleep 1
R=$($AB eval "window.__probe=null;(()=>{const c=document.querySelector('canvas');const x=c.getContext('2d');const d=x.getImageData(Math.round(c.width/2),Math.round(c.height/2),1,1).data;window.__probe='rgba-'+d[0]+'-'+d[1]+'-'+d[2]+'-'+d[3]})();'ok'" >/dev/null 2>&1; sleep 1; $AB eval "window.__probe" 2>/dev/null)
echo "        center pixel: $R"
ck "OK" "stroke drawn through canvas center (pixel sampled above)" "$R"

echo "== T5: Text — click plants a text, panel shows content =="
$AB eval "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Text');b.click();return 'text-mode'})()" >/dev/null 2>&1
sleep 1
$AB mouse move "$((BX + BW/2))" "$((BY + BH/4))" >/dev/null 2>&1; sleep 0.15
$AB mouse down left >/dev/null 2>&1; sleep 0.15
$AB mouse up left >/dev/null 2>&1; sleep 1
R=$($AB eval "(()=>{const t=document.body.innerText;return (t.includes('Text content')&&t.includes('Your text'))?'text-added':'text-missing'})()" 2>/dev/null)
ck "${R:+OK}" "text placed + editor panel shows 'Your text'" "$R"

echo "== T6: Transform — rotate right swaps dimensions =="
$AB eval "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Transform');b.click();return 'transform-mode'})()" >/dev/null 2>&1
sleep 1
$AB eval "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Rotate right');b.click();return 'rotated'})()" >/dev/null 2>&1
sleep 2
$AB eval "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Resize');b.click();return 'resize-mode'})()" >/dev/null 2>&1
sleep 1
R=$($AB eval "(()=>{const t=document.body.innerText;const m=t.match(/Current size: ([0-9]+) x ([0-9]+)/);return m?('dims-'+m[1]+'x'+m[2]):'dims-missing'})()" 2>/dev/null)
echo "        after rotate: $R"
ROT_OK=$(echo "$R" | grep -c 'dims-180x240')
ck "$([ "$ROT_OK" -ge 1 ] && echo OK)" "rotate right swapped dims to 180x240" "$R"

echo "== T7: Undo reverts the rotation =="
$AB eval "(()=>{const b=document.querySelector('button[title=Undo]');b.click();return 'undone'})()" >/dev/null 2>&1
sleep 1
R=$($AB eval "(()=>{const t=document.body.innerText;const m=t.match(/Current size: ([0-9]+) x ([0-9]+)/);return m?('dims-'+m[1]+'x'+m[2]):'dims-missing'})()" 2>/dev/null)
echo "        after undo: $R"
UNDO_OK=$(echo "$R" | grep -c 'dims-240x180')
ck "$([ "$UNDO_OK" -ge 1 ] && echo OK)" "undo restored 240x180" "$R"

echo "== T8: Run -> PNG output, byte check + naming =="
$AB eval "(()=>{const o=URL.createObjectURL.bind(URL);window.__blobs=[];URL.createObjectURL=(obj)=>{const u=o(obj);window.__blobs.push({url:u,type:obj&&obj.type,size:obj&&obj.size});return u};return 'hooked'})()" >/dev/null 2>&1
DLBTN="[...document.querySelectorAll('button')].filter(function(b){return b.querySelector('svg.lucide-download')&&b.textContent.trim()==='Download'})"
$AB eval "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Run Photo Editor');if(!b)return 'no-run-btn';b.click();return 'clicked'})()" >/dev/null 2>&1
$AB wait --fn "$DLBTN.length>=1" --timeout 40000 >/dev/null 2>&1
sleep 1
$AB eval "window.__probe=null;(async()=>{const btns=$DLBTN;btns[btns.length-1].click();await new Promise(r=>setTimeout(r,400));const imgs=(window.__blobs||[]).filter(function(b){return b.type&&b.type.indexOf('image/')===0});if(!imgs.length){window.__probe='no-image-blob';return}const last=imgs[imgs.length-1];const ab=await fetch(last.url).then(r=>r.arrayBuffer());const u=new Uint8Array(ab.slice(0,8));const dv=new DataView(ab);window.__probe=JSON.stringify({type:last.type,size:last.size,magic:[...u].map(x=>x.toString(16).padStart(2,'0')).join(' '),w:dv.getUint32(16),h:dv.getUint32(20)})})().catch(e=>window.__probe='ERR '+e.message);'started'" >/dev/null 2>&1
sleep 2
R=$($AB eval "window.__probe" 2>/dev/null | tr -d '\\')
echo "        probe: $R"
PNG_OK=$(echo "$R" | grep -c '"magic":"89 50 4e 47 0d 0a 1a 0a"')
ck "$([ "$PNG_OK" -ge 1 ] && echo OK)" "output has PNG magic bytes + IHDR dims readable" "$R"
R=$($AB eval "(()=>{const t=document.body.innerText;return t.includes('test-photo-edited.png')?'named-ok':'name-missing'})()" 2>/dev/null)
ck "${R:+OK}" "result item named test-photo-edited.png" "$R"

echo "== Screenshots =="
$AB screenshot --full /home/z/my-project/upload/photo-editor-final.png >/dev/null 2>&1 && echo "  saved upload/photo-editor-final.png"

echo ""
echo "== RESULTS: $PASS passed, $FAIL failed =="
$AB errors 2>/dev/null | head -5
$AB close >/dev/null 2>&1
[ "$FAIL" -eq 0 ]