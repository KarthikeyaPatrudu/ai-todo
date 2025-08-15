// AI To‑Do app (localStorage + optional OpenAI)
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

const state = {
  tasks: JSON.parse(localStorage.getItem('tasks')||'[]'),
  filter: 'all',
  query: '',
  settings: JSON.parse(localStorage.getItem('settings')||'{}')
};

const list = $('#list');
const tpl = $('#itemTpl');

function save(){ localStorage.setItem('tasks', JSON.stringify(state.tasks)); render(); }
function fmtDate(d){
  if(!d) return '';
  const dt = new Date(d);
  return dt.toLocaleDateString();
}
function render(){
  list.innerHTML = '';
  const now = new Date();
  const items = state.tasks.filter(t => {
    if(state.filter==='active' && t.completed) return false;
    if(state.filter==='completed' && !t.completed) return false;
    if(state.filter==='today' && (!t.due || new Date(t.due).toDateString()!==now.toDateString())) return false;
    if(state.filter==='high' && t.priority !== 'high') return false;
    if(state.query && !t.title.toLowerCase().includes(state.query.toLowerCase())) return false;
    return true;
  });
  $('#count').textContent = `${items.length} item${items.length!==1?'s':''}`;
  for(const t of items){
    const node = tpl.content.firstElementChild.cloneNode(true);
    const title = node.querySelector('.title');
    const toggle = node.querySelector('.toggle');
    const meta = node.querySelector('.meta');
    const prio = node.querySelector('.prio');
    const dueBtn = node.querySelector('.due');
    node.dataset.id = t.id;

    title.value = t.title;
    title.classList.toggle('completed', !!t.completed);
    toggle.checked = !!t.completed;
    meta.textContent = [t.priority==='high'?'High • ':'' , t.due?`Due ${fmtDate(t.due)}`:''].join('');
    prio.classList.toggle('active', t.priority==='high');

    toggle.addEventListener('change', () => { t.completed = toggle.checked; save(); });
    title.addEventListener('input', () => { t.title = title.value; save(); });
    node.querySelector('.del').addEventListener('click', () => { 
      state.tasks = state.tasks.filter(x=>x.id!==t.id); save(); 
    });
    prio.addEventListener('click', () => { t.priority = (t.priority==='high'? 'normal':'high'); save(); });
    dueBtn.addEventListener('click', async () => {
      const d = prompt('Set due date (YYYY-MM-DD):', t.due? t.due.substring(0,10): '');
      if(d){ t.due = new Date(d).toISOString(); save(); }
    });

    list.appendChild(node);
  }
}

$('#addBtn').addEventListener('click', addTask);
$('#taskInput').addEventListener('keydown', e => { if(e.key==='Enter') addTask(); });
function addTask(){
  const v = $('#taskInput').value.trim();
  if(!v) return;
  state.tasks.unshift({ id: crypto.randomUUID(), title:v, completed:false, priority:'normal', createdAt: new Date().toISOString() });
  $('#taskInput').value = '';
  save();
}
$('#filterSelect').addEventListener('change', e => { state.filter = e.target.value; render(); });
$('#search').addEventListener('input', e => { state.query = e.target.value; render(); });
$('#clearCompleted').addEventListener('click', ()=>{
  state.tasks = state.tasks.filter(t=>!t.completed); save();
});

// Import/Export
$('#exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state.tasks, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'tasks.json';
  a.click();
});
$('#importBtn').addEventListener('click', () => $('#importFile').click());
$('#importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0]; if(!file) return;
  const text = await file.text();
  try{ state.tasks = JSON.parse(text); save(); } catch(err){ alert('Invalid JSON'); }
});

// Settings & AI
const settings = $('#settings');
$('#settingsBtn').addEventListener('click', ()=> settings.showModal());
$('#saveSettings').addEventListener('click', (e)=>{
  e.preventDefault();
  state.settings.key = $('#apiKey').value.trim();
  state.settings.model = $('#model').value.trim() || 'gpt-4o-mini';
  const remember = $('#saveKey').checked;
  localStorage.setItem('settings', JSON.stringify(state.settings));
  if(!remember){ // don't persist key if flag not set
    const temp = JSON.parse(localStorage.getItem('settings'));
    delete temp.key;
    localStorage.setItem('settings', JSON.stringify(temp));
  }
  settings.close();
});

// Load saved settings
const stored = JSON.parse(localStorage.getItem('settings')||'{}');
$('#model').value = stored.model || 'gpt-4o-mini';
if(stored.key){ $('#apiKey').value = stored.key; $('#saveKey').checked = true; }

// AI Plan: take tasks, ask LLM to prioritize and suggest due dates
$('#aiSuggest').addEventListener('click', async () => {
  const key = state.settings.key;
  if(!key){ alert('Add your OpenAI API key in Settings (⚙️) to use AI.'); return; }
  const prompt = `You are an assistant that reorganizes a to-do list. 
Return JSON with tasks in priority order and optional ISO due date. 
If title already looks like a task, reuse it; otherwise expand briefly.
Input tasks: ${JSON.stringify(state.tasks.map(t=>({title:t.title, priority:t.priority, due:t.due})))}`;

  try{
    const res = await fetch('https://api.openai.com/v1/responses', {
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'Authorization':`Bearer ${key}`
      },
      body: JSON.stringify({
        model: state.settings.model || 'gpt-4o-mini',
        input: prompt,
        response_format: { type: "json_object" }
      })
    });
    if(!res.ok){ throw new Error(await res.text()); }
    const data = await res.json();
    // Extract text: 'output' may vary; fall back to JSON.parse on combined content
    let text = "";
    if (data.output && data.output[0] && data.output[0].content) {
      text = data.output[0].content[0]?.text || "";
    } else if (data.content) {
      text = data.content[0]?.text || "";
    } else if (data.choices && data.choices[0]) {
      text = data.choices[0].message?.content || "";
    }
    const parsed = JSON.parse(text || "{}");
    const next = (parsed.tasks || []).map(t => ({
      id: crypto.randomUUID(),
      title: t.title || t,
      completed:false,
      priority: t.priority || 'normal',
      due: t.due || null,
      createdAt: new Date().toISOString()
    }));
    if(next.length){
      state.tasks = next;
      save();
      alert('AI planned your tasks ✨');
    } else {
      alert('AI did not return tasks. Try again.');
    }
  }catch(err){
    console.error(err);
    alert('AI request failed. Check your API key and network.');
  }
});

render();
