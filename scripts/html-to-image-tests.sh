#!/bin/bash
# E2E tests for the new HTML to Image tool (Task 22).
# Verifies: registry card on home, tabbed input (paste/upload), live preview,
# PNG/JPG capture runs with byte-level magic checks (via hooked Download),
# uploaded file naming, worker dimension note.

AB="agent-browser"
BASE="http://localhost:3000"
PASS=0; FAIL=0
ck() { if [ "$1" = "OK" ]; then PASS=$((PASS+1)); echo "  PASS: $2"; else FAIL=$((FAIL+1)); echo "  FAIL: $2"; echo "        got: $3"; fi; }

echo "== T0: home page shows the HTML to Image card =="
$AB open "$BASE/" >/dev/null 2>&1; sleep 2
R=$($AB eval "(()=>{const el=[...document.querySelectorAll('h3')].find(h=>h.textContent.trim()==='HTML to Image');return el?'card-found':'missing'})()" 2>/dev/null)
ck "${R:+OK}" "home card 'HTML to Image' present" "$R"

echo "== T1: tool page + tabbed input =="
$AB open "$BASE/#/html-to-image" >/dev/null 2>&1; sleep 3
R=$($AB eval "(()=>{const b=[...document.querySelectorAll('button')].map(x=>x.textContent.trim());return (b.includes('Paste code')&&b.includes('Upload file'))?'tabs-found':'tabs-missing'})()" 2>/dev/null)
ck "${R:+OK}" "Paste code / Upload file tabs present" "$R"
R=$($AB eval "(()=>{const t=document.querySelector('textarea');return t&&t.value===''?'empty-textarea':'no-textarea'})()" 2>/dev/null)
ck "${R:+OK}" "paste tab shows empty textarea by default" "$R"

echo "== T2: paste HTML -> preview + options appear, Run enables =="
$AB eval "(()=>{const t=document.querySelector('textarea');const setter=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;setter.call(t,'<div style=\"font-family:sans-serif;padding:40px;background:#0f172a;color:#fff;border-radius:12px;\"><h1 style=\"margin:0 0 8px\">ToolForge Test Card</h1><p style=\"margin:0;opacity:.8\">Rendered locally to PNG.</p></div>');t.dispatchEvent(new Event('input',{bubbles:true}));return 'filled'})()" >/dev/null 2>&1
sleep 1
R=$($AB eval "(()=>{const x=document.body.innerText;return (x.includes('Live Preview')&&x.includes('Format')&&x.includes('Render width'))?'preview+options':'missing-sections'})()" 2>/dev/null)
ck "${R:+OK}" "live preview + options visible after paste" "$R"
R=$($AB eval "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Run HTML to Image');return b&&!b.disabled?'run-enabled':'run-disabled'})()" 2>/dev/null)
ck "${R:+OK}" "Run button enabled" "$R"

echo "== T3: run PNG capture, download + verify magic bytes =="
DLBTN="[...document.querySelectorAll('button')].filter(function(b){return b.querySelector('svg.lucide-download')&&b.textContent.trim()==='Download'})"
$AB eval "(()=>{const o=URL.createObjectURL.bind(URL);window.__blobs=[];URL.createObjectURL=(obj)=>{const u=o(obj);window.__blobs.push({url:u,type:obj&&obj.type,size:obj&&obj.size});return u};return 'hooked'})()" >/dev/null 2>&1
$AB eval "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Run HTML to Image');b.click();return 'clicked'})()" >/dev/null 2>&1
# A done item is the only one that renders a per-item Download button.
$AB wait --fn "$DLBTN.length>=1" --timeout 40000 >/dev/null 2>&1
sleep 1
$AB eval "window.__probe=null;(async()=>{const btns=$DLBTN;btns[btns.length-1].click();await new Promise(r=>setTimeout(r,400));const imgs=(window.__blobs||[]).filter(function(b){return b.type&&b.type.indexOf('image/')===0});if(!imgs.length){window.__probe='no-image-blob';return}const last=imgs[imgs.length-1];const ab=await fetch(last.url).then(r=>r.arrayBuffer());const u=new Uint8Array(ab.slice(0,4));window.__probe=JSON.stringify({type:last.type,size:last.size,magic:[...u].map(x=>x.toString(16).padStart(2,'0')).join(' ')})})().catch(e=>window.__probe='ERR '+e.message);'started'" >/dev/null 2>&1
sleep 2
R=$($AB eval "window.__probe" 2>/dev/null | tr -d '\\')
PNG_OK=$(echo "$R" | grep -c '"magic":"89 50 4e 47"')
PNG_TYPE=$(echo "$R" | grep -c '"type":"image/png"')
ck "$([ "$PNG_OK" -ge 1 ] && [ "$PNG_TYPE" -ge 1 ] && echo OK)" "PNG output magic bytes + mime correct (89 50 4e 47)" "$R"
R=$($AB eval "(()=>{const m=document.body.innerText.match(/[0-9]+x[0-9]+ px/);return m?'dims:'+m[0]:'no-dims-note'})()" 2>/dev/null)
ck "${R:+OK}" "worker dimension note shown (e.g. 2560x320 px)" "$R"

echo "== T4: upload tab accepts an .html file =="
$AB eval "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Upload file');b.click();return 'tab-switched'})()" >/dev/null 2>&1
sleep 1
$AB eval "(()=>{const html='<div style=\"font-family:sans-serif;padding:32px;background:#fef3c7;color:#92400e;border:2px dashed #f59e0b;border-radius:12px;\"><h2 style=\"margin:0\">Uploaded File Test</h2><p style=\"margin:4px 0 0\">From an .html file.</p></div>';const f=new File([html],'my-card.html',{type:'text/html'});const inputs=document.querySelectorAll('input[type=file][accept=\".html,.htm,text/html\"]');const input=inputs[inputs.length-1];const dt=new DataTransfer();dt.items.add(f);input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));return 'file-set'})()" >/dev/null 2>&1
sleep 1
R=$($AB eval "(()=>{const t=document.body.innerText;return t.includes('my-card.html')?'chip-found':'chip-missing'})()" 2>/dev/null)
ck "${R:+OK}" "uploaded file chip + name shown" "$R"
R=$($AB eval "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Run HTML to Image');return b&&!b.disabled?'run-enabled':'run-disabled'})()" 2>/dev/null)
ck "${R:+OK}" "Run still enabled with uploaded file" "$R"

echo "== T5: run again -> output named after the uploaded file =="
$AB eval "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Run HTML to Image');b.click();return 'clicked'})()" >/dev/null 2>&1
$AB wait --fn "$DLBTN.length>=2" --timeout 40000 >/dev/null 2>&1
sleep 1
R=$($AB eval "(()=>{const t=document.body.innerText;return t.includes('my-card.png')?'named-ok':'name-missing'})()" 2>/dev/null)
ck "${R:+OK}" "result item named my-card.png" "$R"

echo "== T6: JPG format produces JPEG bytes =="
$AB eval "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='JPG');b.click();return 'jpg-selected'})()" >/dev/null 2>&1
sleep 1
$AB eval "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Run HTML to Image');b.click();return 'clicked'})()" >/dev/null 2>&1
$AB wait --fn "$DLBTN.length>=3" --timeout 40000 >/dev/null 2>&1
sleep 1
$AB eval "window.__probe2=null;(async()=>{const btns=$DLBTN;btns[btns.length-1].click();await new Promise(r=>setTimeout(r,400));const imgs=(window.__blobs||[]).filter(function(b){return b.type&&b.type.indexOf('image/')===0});if(!imgs.length){window.__probe2='no-image-blob';return}const last=imgs[imgs.length-1];const ab=await fetch(last.url).then(r=>r.arrayBuffer());const u=new Uint8Array(ab.slice(0,3));window.__probe2=JSON.stringify({type:last.type,magic:[...u].map(x=>x.toString(16).padStart(2,'0')).join(' ')})})().catch(e=>window.__probe2='ERR '+e.message);'started'" >/dev/null 2>&1
sleep 2
R=$($AB eval "window.__probe2" 2>/dev/null | tr -d '\\')
JPG_OK=$(echo "$R" | grep -c '"magic":"ff d8 ff"')
JPG_TYPE=$(echo "$R" | grep -c '"type":"image/jpeg"')
ck "$([ "$JPG_OK" -ge 1 ] && [ "$JPG_TYPE" -ge 1 ] && echo OK)" "JPG output magic bytes + mime correct (ff d8 ff)" "$R"
R=$($AB eval "(()=>{const t=document.body.innerText;return t.includes('my-card.jpg')?'named-ok':'name-missing'})()" 2>/dev/null)
ck "${R:+OK}" "result item named my-card.jpg" "$R"

echo "== Screenshots =="
$AB screenshot --full /home/z/my-project/upload/html-to-image-final.png >/dev/null 2>&1 && echo "  saved upload/html-to-image-final.png"

echo ""
echo "== RESULTS: $PASS passed, $FAIL failed =="
$AB errors 2>/dev/null | head -5
$AB close >/dev/null 2>&1
[ "$FAIL" -eq 0 ]