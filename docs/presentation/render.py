"""Render the paired CLI outcomes. Python standard library only."""
import hashlib, html, json
from pathlib import Path
ROOT = Path(__file__).resolve().parent
DATA = json.loads((ROOT / "paired-outcomes.json").read_text())
A, T = [DATA["outcomes"][name] for name in ("approved", "timeouts")]
assert hashlib.sha256((ROOT.parents[1] / DATA["script"]).read_bytes()).hexdigest() == DATA["script_sha256"]
assert A["result"] == 0 and T["result"] == 1
assert A["emitted"]["balance"] == T["emitted"]["balance"]
assert all(o["execution"]["importReexecutedDecisions"] == 1 and o["execution"]["branchPrefixReexecuted"] is False for o in (A,T))
CUT = DATA["shared_cut"]["pending"]
MEMORY_MIB = DATA["shared_cut"]["summary"]["memoryBytes"] // (1024*1024)
assert CUT["pendingLabel"] == "Confirm transfer"
assert A["emitted"]["conserved"] and not T["emitted"]["conserved"]

def text(x, y, value, size=20, color="#202a3b", weight=400):
    return f'<text x="{x}" y="{y}" font-family="Arial, sans-serif" font-size="{size}" fill="{color}" font-weight="{weight}">{html.escape(str(value))}</text>'

def rect(x,y,w,h,fill="#ffffff",stroke="#d3dbe8",radius=12):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{radius}" fill="{fill}" stroke="{stroke}"/>'

def render(mobile=False):
    w,h=(440,1090) if mobile else (1000,650)
    parts=[f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" role="img" aria-labelledby="fork-title fork-desc">',
      '<title id="fork-title">One cut. Two ledgers.</title>',
      '<desc id="fork-desc">Actual synthetic transfer run. The same saved Confirm transfer cut produces total 120 after approval and total 95 after two timeouts. Import revalidates one earlier decision; the subsequent branches do not replay that prefix.</desc>',
      f'<rect width="{w}" height="{h}" fill="#f6f8fc"/>']
    margin=24 if mobile else 40
    parts += [text(margin,38 if mobile else 44,"FORKWAKE / EXECUTION RECORD",13,"#4d617e",700),
      text(margin,82 if mobile else 95,"One cut. Two ledgers.",30 if mobile else 43,weight=700),
      text(margin,116 if mobile else 133,"A deliberately faulty JavaScript transfer",17 if mobile else 21)]
    cut_y=145 if mobile else 165
    cut_w=w-2*margin
    parts += [rect(margin,cut_y,cut_w,125,"#edf2ff","#2458da"),
      text(margin+20,cut_y+29,"SAVED CUT · Confirm transfer",17,"#2458da",700),
      text(margin+20,cut_y+64,f'Sender {A["emitted"]["balance"]} · reserved amount {CUT["pendingPayload"]["amount"]}',19),
      text(margin+20,cut_y+95,f'Closure {CUT["pendingPayload"]["phase"]} · {MEMORY_MIB} MiB guest memory',18)]
    if mobile:
      cards=[(24,310,392,283,A,"APPROVAL",["Confirm → 1", "Publish receipt → 1"],"#2458da"),
             (24,635,392,318,T,"TWO TIMEOUTS",["Confirm → −1", "Retry → −1", "Publish receipt → 1"],"#b23124")]
      parts += ['<path d="M220 270 V286 H12 V650 H24 M12 325 H24" fill="none" stroke="#8a9bb3" stroke-width="2"/>',
        text(24,617,"Alternate branch from the same cut",14,"#4d617e")]
    else:
      cards=[(40,330,440,230,A,"APPROVAL",["Confirm → 1 · Publish receipt → 1"],"#2458da"),
             (520,330,440,230,T,"TWO TIMEOUTS",["Confirm → −1 · Retry → −1", "Publish receipt → 1"],"#b23124")]
      parts += ['<path d="M500 290 V305 H260 V330 M500 305 H740 V330" fill="none" stroke="#8a9bb3" stroke-width="2"/>']
    for x,y,cw,ch,out,title,trace,color in cards:
      e=out["emitted"]; total=e["balance"]+e["recipient"]
      parts += [rect(x,y,cw,ch),text(x+20,y+30,title,15,color,700)]
      for i,t in enumerate(trace): parts.append(text(x+20,y+65+i*28,t,17))
      n=y+(143 if mobile else 133)+(28 if len(trace)==3 else 0)
      parts += [text(x+20,n,f'{e["balance"]} + {e["recipient"]} = {total}',36,color,700),
        text(x+20,n+37,f'Sender + recipient · resultI32 = {out["result"]}',16),
        text(x+20,n+66,'conserved: '+str(e["conserved"]).lower(),18,color,700)]
    if mobile:
      parts += [text(24,995,"Import checks 1 earlier decision once.",17),text(24,1023,"Each branch resumes that verified cut.",17),text(24,1061,"Modeled values, not a real payment service.",15,"#4d617e")]
    else:
      parts += [text(40,602,"Import checks 1 earlier decision once. Each branch then resumes the verified cut.",18),text(40,630,"Actual CLI output · modeled values, not a real payment service · source and raw records linked below",14,"#4d617e")]
    parts.append('</svg>');svg=''.join(parts)
    name='same-cut-mobile' if mobile else 'same-cut'
    page='<!doctype html><html lang="en"><meta charset="utf-8"><title>Forkwake: one cut, two ledgers</title><style>body{margin:0;background:#f6f8fc}svg{display:block;width:100%;height:auto}</style>'+svg+'</html>'
    (ROOT/(name+'.html')).write_text(page)
    # The HTML inline SVG is the source of truth. Export that exact element.
    (ROOT/(name+'.svg')).write_text(svg+'\n')

render(); render(True)
