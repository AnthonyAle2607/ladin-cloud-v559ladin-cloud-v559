const SESSION='ladinCloudSession_v1';
const API_BASE='';
let db={users:[],clients:[],labels:[],containers:[],history:[],complaints:[],teamNotes:[]};
let session=JSON.parse(localStorage.getItem(SESSION)||'null');
let currentView='dashboard'; let searchTerm=''; let clientPageSearchValue=''; let labelPageSearchValue=''; let clientSortOrder='desc'; let labelSortOrder='desc'; let portfolioAdvisorFilter=''; let portfolioClientFilter=''; let portfolioLabelFilter=''; let portfolioRemote=null; let portfolioLoading=false;
const VENEZUELA_STATES=['Amazonas','Anzoátegui','Apure','Aragua','Barinas','Bolívar','Carabobo','Cojedes','Delta Amacuro','Distrito Capital','Falcón','Guárico','La Guaira','Lara','Mérida','Miranda','Monagas','Nueva Esparta','Portuguesa','Sucre','Táchira','Trujillo','Yaracuy','Zulia'];

async function api(path, options={}){
  const headers={'Content-Type':'application/json',...(options.headers||{})};
  if(session?.token) headers.Authorization=`Bearer ${session.token}`;
  const fetchOptions={...options,headers}; if(!fetchOptions.method || String(fetchOptions.method).toUpperCase()==='GET') fetchOptions.cache='no-store'; const res=await fetch(API_BASE+path,fetchOptions);
  const text=await res.text(); let data={};
  try{data=text?JSON.parse(text):{};}catch{throw new Error(text||`HTTP ${res.status}`)}
  if(!res.ok) throw new Error(data.error||`HTTP ${res.status}`);
  return data;
}
async function loadRemote(){ db=await api('/api/bootstrap'); }
function safeRemove(k){try{localStorage.removeItem(k)}catch{}}
function me(){return db.users.find(u=>u.id===session?.userId)}
function scopedClients(){const u=me();return u?.role==='admin'?db.clients:db.clients.filter(c=>c.advisorId===u?.id)}
function scopedLabels(){const cs=new Set(scopedClients().map(c=>c.id));return me()?.role==='admin'?db.labels:db.labels.filter(l=>cs.has(l.clientId))}
function scopedContainers(){return db.containers}
function esc(v=''){return String(v).replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\\':'&#92;'}[c]))}
function fmtDate(d){if(!d)return '—';const raw=String(d);const s=/^\d{4}-\d{2}-\d{2}/.test(raw)?raw.slice(0,10):(d instanceof Date&&!Number.isNaN(d.getTime())?d.toISOString().slice(0,10):raw.slice(0,10));const [y,m,day]=s.split('-');return y&&m&&day?`${day}/${m}/${y}`:'—'}
function fmtDT(d){if(!d)return '—';return new Date(d).toLocaleString('es-VE',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})}
function userName(id){return db.users.find(u=>u.id===id)?.name||'—'}
function clientName(id){return db.clients.find(c=>c.id===id)?.name||'Sin cliente'}
function sameRefId(a,b){return String(a??'').replace(/^[^0-9]*/,'')===String(b??'').replace(/^[^0-9]*/,'')}
function containerName(id){return db.containers.find(c=>c.id===id)?.number||'Sin contenedor'}
function labelEffectiveStatus(l){return l?.status||'prep'}
function labelFamilyRoot(l){if(!l)return null;return l.parentLabelId?db.labels.find(x=>String(x.id)===String(l.parentLabelId))||null:l;}
function familyChildren(l){const root=labelFamilyRoot(l);return root?db.labels.filter(x=>String(x.parentLabelId)===String(root.id)):[];}
function familySummary(l){const root=labelFamilyRoot(l);if(!root)return null;const subs=familyChildren(root);if(!l.parentLabelId&&!l.isFamilyParent&&!subs.length)return null;const expected=Math.max(0,Number(root.boxesPacking||0));const baseWarehouse=Math.max(0,Number(root.boxesChina||0));const subReceived=subs.reduce((sum,x)=>sum+Math.max(0,Number(x.boxesPacking||0)),0);const registered=Math.min(expected,baseWarehouse+subReceived);const rawRegistered=baseWarehouse+subReceived;const remaining=Math.max(expected-registered,0);const over=expected>0&&rawRegistered>expected;const mismatch=false;const progress=expected>0?Math.min(100,Math.round((registered/expected)*100)):0;const cbmExpected=Math.max(0,Number(root.cbmPacking||0));const cbmMainReal=Math.max(0,Number(root.cbmChina||0));const cbmSubReal=subs.reduce((sum,x)=>sum+Math.max(0,Number(x.cbmChina||0)),0);const cbmRealTotal=cbmMainReal+cbmSubReal;const cbmRemaining=Math.max(cbmExpected-cbmRealTotal,0);return {root,subs,expected,baseWarehouse,subReceived,registered,rawRegistered,remaining,progress,complete:expected>0&&registered===expected,over,mismatch,cbmExpected,cbmMainReal,cbmSubReal,cbmRealTotal,cbmRemaining};}
function badgeStatus(type,val){const maps={client:{pending:['Por atender','pending'],process:['Atendiendo','process'],done:['Atendido','done'],inactive:['Inactivo','inactive']},label:{prep:['Preparando','prep'],transit:['En tránsito','transit'],ve:['En Venezuela','ve'],done:['Facturado','facturado'],facturado:['Facturado','facturado'],closed:['Cerrado','closed']},container:{prep:['Preparando','prep'],transit:['En tránsito','transit'],ve:['En Venezuela','ve'],done:['Entregado','done'],closed:['Cerrado','closed']}};const x=maps[type]?.[val]||[val||'—','inactive'];return `<span class="badge ${x[1]}">${x[0]}</span>`}

function mount(){const root=document.getElementById('app');if(!root)return; if(!session){root.innerHTML=loginHTML();bindGlobal();return;} root.innerHTML=shellHTML();renderView();bindGlobal();}
function loginHTML(){return `<div class="login"><div class="login-card"><div class="login-brand"><img class="brand-logo-img login-logo-img" src="ladin-logo.png" alt="Ladin Cloud"></div><div class="sub login-sub">Sistema interno de gestión</div><div class="field"><label>Correo</label><input id="loginEmail" type="email" autocomplete="username"></div><div class="field"><label>Contraseña</label><input id="loginPass" type="password" autocomplete="current-password"></div><div id="loginErr" class="error"></div><button class="btn btn-primary" id="loginBtn" style="width:100%">Iniciar sesión</button></div></div>`}
function shellHTML(){const role=me()?.role;return `<div class="app" style="display:block"><aside class="sidebar"><div class="brand-side"><img class="brand-logo-img side-logo-img" src="ladin-logo.png" alt="Ladin Cloud"></div><nav class="nav"><button data-view="dashboard">🏠 Inicio</button><button data-view="clients">👥 Clientes</button><button data-view="labels">🏷️ Etiquetas</button><button data-view="containers">🚢 Contenedores</button>${role==='admin'?'<button data-view="reports">📊 Reportes</button>':''}<button data-view="complaints">💬 ${role==='admin'?'Quejas del equipo':'Reportar queja'}</button>${role==='admin'?'<button data-view="users">⚙️ Usuarios</button><button data-view="backups">💾 Hacer copia de seguridad</button>':''}</nav><div class="sidebar-bottom"><div class="user-mini"><b>${esc(me()?.name||'Usuario')}</b>${role==='admin'?'Administrador':'Asesora'}</div><button class="btn btn-secondary" id="logoutBtn" style="width:100%">Cerrar sesión</button></div></aside><main class="main"><header class="topbar"><div class="search"><span>⌕</span><input id="globalSearch" placeholder="Buscar clientes, etiquetas, contenedores, recordatorios..." value="${esc(searchTerm)}"><div id="globalSearchResults" class="global-search-results"></div></div><div class="topbar-user">${esc(me()?.name||'')}</div></header><section id="page" class="page"></section></main></div><div class="modal-backdrop" id="modal"></div><div class="toast" id="toast"></div>`}

async function renderView(){resetExampleSearchArtifacts();document.querySelectorAll('.nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===currentView));const p=document.getElementById('page');if(!p)return;const views={dashboard:dashboardView,clients:clientsView,labels:labelsView,containers:containersView,reports:reportsView,complaints:complaintsView,users:usersView,backups:backupsView};const view=views[currentView]||dashboardView; p.innerHTML=await Promise.resolve(view()); bindView(); if(currentView==='backups') loadBackupStatus();}

function capturePageSearchValues(){
  const clientInput=document.getElementById('clientPageSearch');
  const labelInput=document.getElementById('labelPageSearch');
  if(clientInput) clientPageSearchValue=String(clientInput.value||'');
  if(labelInput) labelPageSearchValue=String(labelInput.value||'');
}
function safeSearchValue(key){
  if(key==='clientPageSearch') return String(clientPageSearchValue||'');
  if(key==='labelPageSearch') return String(labelPageSearchValue||'');
  return '';
}
function resetExampleSearchArtifacts(){}
function recordTimestamp(item){const v=item?.createdAt||item?.updatedAt||item?.firstContactDate||item?.date||0;const t=Date.parse(v);return Number.isFinite(t)?t:0;}
function sortByRecency(items,order='desc'){return [...items].sort((a,b)=>{const d=recordTimestamp(b)-recordTimestamp(a);if(d!==0)return order==='desc'?d:-d;const an=String(a?.name||a?.number||a?.code||'').toLowerCase();const bn=String(b?.name||b?.number||b?.code||'').toLowerCase();return an.localeCompare(bn);});}
function sortToggleHTML(type,order){const isClient=type==='client';const activeDesc=isClient?clientSortOrder==='desc':labelSortOrder==='desc';return `<div class="sort-toggle" title="Ordenar por fecha"><button type="button" class="sort-toggle-btn ${activeDesc?'active':''}" data-sort-type="${type}" data-sort-order="desc" title="Más reciente al más antiguo">↓ Recientes</button><button type="button" class="sort-toggle-btn ${!activeDesc?'active':''}" data-sort-type="${type}" data-sort-order="asc" title="Más antiguo al más reciente">↑ Antiguos</button></div>`;}
function clientsView(){let cs=scopedClients();cs=sortByRecency(cs,clientSortOrder);const q=safeSearchValue('clientPageSearch').trim().toLowerCase();if(q)cs=cs.filter(c=>`${c.code||''} ${c.name||''} ${c.phone||''} ${c.email||''} ${c.company||''}`.toLowerCase().includes(q));if(me()?.role==='admin'&&window.clientPageAdvisorFilter)cs=cs.filter(c=>sameRefId(c.advisorId,window.clientPageAdvisorFilter));const af=me()?.role==='admin'?`<div class="field"><label>Asesora</label><select id="clientAdvisorFilter"><option value="">Todas las asesoras</option>${db.users.filter(u=>u.role==='asesora'&&u.active).map(u=>`<option value="${esc(u.id)}" ${String(window.clientPageAdvisorFilter||'')===String(u.id)?'selected':''}>${esc(u.name)}${u.advisorCode?' · '+esc(u.advisorCode):''}</option>`).join('')}</select></div>`:'';return `<div class="page-head"><div><h1>Clientes</h1><p>Gestiona y consulta el estado de atención.</p></div><button class="btn btn-primary" id="newClient">+ Nuevo cliente</button></div><div class="card section"><div class="client-tools"><div class="field client-search-field"><label>Buscar por nombre o código</label><div class="page-search-row"><input id="clientPageSearch" value="${esc(safeSearchValue('clientPageSearch'))}" placeholder="Nombre o código de cliente..." autocomplete="off"><button class="btn btn-primary btn-sm page-search-btn" id="clientPageSearchBtn" type="button">Consultar</button></div></div>${af}<div class="sort-control-wrap"><span class="sort-control-label">Orden</span>${sortToggleHTML('client',clientSortOrder)}</div></div><div class="table-wrap"><table class="table"><thead><tr><th>Código</th><th>Cliente</th><th>Asesora</th><th>Código asesora</th><th>Estado</th><th>Estado Venezuela</th><th>Primer contacto</th><th>Etiquetas</th><th></th></tr></thead><tbody id="clientsTableBody">${renderClientRowsHTML(cs)}</tbody></table></div></div>`;}
function renderClientRowsHTML(cs){return cs.map(c=>{const n=scopedLabels().filter(l=>l.clientId===c.id).length;return `<tr><td><span class="code-pill">${esc(c.code||'—')}</span></td><td><b>${esc(c.name)}</b><div class="muted">${esc(c.company||c.phone||'')}</div></td><td>${esc(userName(c.advisorId))}</td><td>${esc(c.advisorCode||'—')}</td><td>${badgeStatus('client',c.status)}</td><td>${esc(c.state||'—')}</td><td>${fmtDate(c.firstContactDate)}</td><td>${n}</td><td><button class="btn btn-secondary btn-sm" data-action="client-view" data-id="${c.id}">Ver</button> <button class="btn btn-secondary btn-sm" data-action="client-edit" data-id="${c.id}">Editar</button> <button class="btn btn-danger btn-sm" data-action="client-delete" data-id="${c.id}">Borrar</button></td></tr>`}).join('')||'<tr><td colspan="9"><div class="empty">No hay clientes para mostrar.</div></td></tr>';}

function labelClientKey(l){return String(l?.clientId||'sin-cliente');}
function renderLabelCard(l, allLabels){
  const fs=familySummary(l);
  const isSub=!!l.parentLabelId;
  const boxText=(l.parentLabelId?`${esc(l.boxesPacking??'0')}`:(fs?`${fs.registered} / ${fs.expected}`:((l.boxesPacking!==''&&l.boxesPacking!==undefined)?`${esc(l.boxesChina??0)} / ${esc(l.boxesPacking)}`:'—')));
  const subCount=fs?fs.subs.length:0;
  const children=isSub?[]:allLabels.filter(x=>sameRefId(x.parentLabelId,l.id)).sort((a,b)=>String(a.number||'').localeCompare(String(b.number||'')));
  const actionButtons=`<div class="label-card-actions"><button class="btn btn-secondary btn-sm" data-action="label-view" data-id="${l.id}">Ver detalles</button>${isSub?'':`<button class="btn btn-secondary btn-sm" data-action="label-add-sub" data-id="${l.id}">+ Subetiqueta</button>`}<button class="btn btn-secondary btn-sm" data-action="label-edit" data-id="${l.id}">Editar</button><button class="btn btn-danger btn-sm" data-action="label-delete" data-id="${l.id}">Borrar</button></div>`;
  return `<div class="label-item-card ${isSub?'label-item-sub':''}">
    <div class="label-item-main">
      <div class="label-item-title"><div><strong>${esc(l.number||'—')}</strong><span class="muted">${isSub?'Subetiqueta':'Etiqueta principal'}</span></div>${badgeStatus('label',l.status)}</div>
      <div class="label-item-meta"><span><b>Cajas:</b> ${boxText}</span><span><b>Contenedor:</b> ${esc(containerName(l.containerId)||'Sin contenedor')}</span>${fs?`<span><b>Subetiquetas:</b> ${subCount}</span>`:''}</div>
    </div>${actionButtons}
  </div>${children.length?`<div class="label-sublist">${children.map(x=>renderLabelCard(x,allLabels)).join('')}</div>`:''}`;
}
function renderLabelsByClient(ls){
  const groups=new Map();
  sortByRecency(ls,labelSortOrder).forEach(l=>{const key=labelClientKey(l);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(l);});
  const entries=[...groups.entries()].sort((a,b)=>{const at=Math.max(...a[1].map(recordTimestamp));const bt=Math.max(...b[1].map(recordTimestamp));return labelSortOrder==='desc'?bt-at:at-bt;});
  if(!entries.length)return '<div class="empty">No hay etiquetas para mostrar.</div>';
  return `<div class="label-client-list">${entries.map(([key,items],idx)=>{
    const client=items[0]?.clientId?db.clients.find(c=>sameRefId(c.id,items[0].clientId)):null;
    const roots=sortByRecency(items.filter(l=>!l.parentLabelId),labelSortOrder);
    const total=items.length;
    const pending=roots.reduce((sum,l)=>{const fs=familySummary(l);return sum+(fs?Number(fs.remaining)||0:Math.max(Number(l.boxesPacking||0)-Number(l.boxesChina||0),0));},0);
    return `<details class="label-client-accordion" ${idx===0?'open':''}><summary><div class="label-client-summary"><div><strong>${esc(client?.name||clientName(items[0]?.clientId)||'Cliente sin nombre')}</strong><span class="muted">${esc(client?.code||'')} ${client?.advisorId?'· '+esc(userName(client.advisorId)):''}</span></div><div class="label-client-summary-right"><span class="label-client-count">${total} etiqueta${total===1?'':'s'}</span>${pending>0?`<span class="label-client-pending">${pending} pendientes</span>`:''}<span class="accordion-chevron">⌄</span></div></div></summary><div class="label-client-body">${roots.map(r=>renderLabelCard(r,sortByRecency(items,labelSortOrder))).join('')}${items.filter(l=>l.parentLabelId&&!items.some(r=>sameRefId(r.id,l.parentLabelId))).map(x=>renderLabelCard(x,items)).join('')}</div></details>`;
  }).join('')}</div>`;
}
function labelsView(){
  let ls=scopedLabels();
  const q=safeSearchValue('labelPageSearch').trim().toLowerCase();
  if(q)ls=ls.filter(l=>`${l.number||''} ${clientName(l.clientId)||''} ${containerName(l.containerId)||''} ${l.familyCode||''}`.toLowerCase().includes(q));
  return `<div class="page-head"><div><h1>Etiquetas</h1><p>Busca rápidamente por número, cliente o contenedor.</p></div><button class="btn btn-primary" id="newLabel">+ Nueva etiqueta</button></div><div class="card section"><div class="client-tools"><div class="field"><label>Buscar etiqueta</label><input id="labelPageSearch" value="${esc(safeSearchValue('labelPageSearch'))}" placeholder="Número, cliente o contenedor..." autocomplete="off"></div><div class="sort-control-wrap"><span class="sort-control-label">Orden</span>${sortToggleHTML('label',labelSortOrder)}</div></div><div id="labelSearchResults">${renderLabelsByClient(ls)}</div></div>`;
}

function containersView(){let cs=scopedContainers();if(searchTerm)cs=cs.filter(c=>(c.number+c.origin+c.notes).toLowerCase().includes(searchTerm.toLowerCase()));const admin=me()?.role==='admin';return `<div class="page-head"><div><h1>Contenedores</h1><p>Controla embarques con ATD y ETA.</p></div>${admin?'<button class="btn btn-primary" id="newContainer">+ Nuevo contenedor</button>':''}</div><div class="card section"><div class="table-wrap"><table class="table"><thead><tr><th>Contenedor</th><th>Origen</th><th>ATD</th><th>ETA</th><th>Clientes</th><th>Estado</th>${admin?'<th>CBM</th>':''}<th>Etiquetas</th><th></th></tr></thead><tbody>${cs.map(c=>{const ls=db.labels.filter(l=>l.containerId===c.id);const clients=new Set(ls.map(l=>l.clientId));const realCbm=ls.reduce((sum,l)=>sum+(Number(l.cbmChina)||0),0);return `<tr><td><b>${esc(c.number)}</b></td><td>${esc(c.origin||'Yiwu')}</td><td>${fmtDate(c.departure)}</td><td>${fmtDate(c.eta)}</td><td>${clients.size}</td><td>${badgeStatus('container',c.status)}</td>${admin?`<td><b>${fmtDecimal(realCbm)}</b></td>`:''}<td>${ls.length}</td><td><button class="btn btn-secondary btn-sm" data-action="container-view" data-id="${c.id}">Ver</button>${admin?` <button class="btn btn-secondary btn-sm" data-action="container-edit" data-id="${c.id}">Editar</button> <button class="btn btn-danger btn-sm" data-action="container-delete" data-id="${c.id}">Borrar</button>`:''}</td></tr>`}).join('')||`<tr><td colspan="${admin?9:8}"><div class="empty">No hay contenedores.</div></td></tr>`}</tbody></table></div></div>`}
function complaintModal(){
  openModal('Registrar incidencia operativa',`
    <div class="complaint-form-header"><span class="modal-kicker">Registro de incidencias operativas</span><p>Completa la información para que administración pueda dar seguimiento y responder la incidencia.</p></div>
    <div class="complaint-sheet">
      <div class="complaint-grid">
        ${field('qIncidentDate','Fecha de la incidencia','','date','required')}
        ${field('qAdvisorCode','Código Asesor',me()?.advisorCode||'','text','readonly')}
        ${field('qClientCode','Código Cliente','','text','placeholder="Ej. LC-CLI-000001"')}
        ${field('qLabelCode','Código de Etiqueta','','text','placeholder="Ej. ETQ-000001"')}
        ${field('qArea','Área involucrada','logistica','text','placeholder="Ej. logística"')}
        ${selectField('qPriority','Impacto comercial',[['alto','Alto (Riesgo de pérdida cliente)'],['medio','Medio (Retraso moderado con queja)'],['bajo','Bajo']],'medio')}
        ${field('qSubject','Tipo de incidencia','','text','required placeholder="Ej. Retraso en despacho, pérdida, retraso en etiqueta..."')}
      </div>
      <div class="field"><label>Detalle de la situación</label><textarea id="qDetail" rows="5" required placeholder="Especificar lo ocurrido..."></textarea></div>
      <div class="field"><label>Evidencia / soporte</label><textarea id="qEvidence" rows="4" placeholder="Describe la evidencia, enlaces o detalles adicionales..."></textarea><div class="evidence-upload"><input id="qFiles" type="file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"><small>Adjunta imágenes y documentos. Máximo 15 archivos de 12 MB cada uno.</small><div id="qFileList" class="file-chip-list"></div></div></div>
      <div class="complaint-auto-info"><span><b>Número de incidencia:</b> se asignará automáticamente</span><span><b>Fecha:</b> se guardará con el registro</span></div>
    </div>`,`<button class="btn btn-secondary" id="modalCancel">Cancelar</button><button class="btn btn-primary" id="modalSave">Enviar incidencia</button>`);
  const date=document.getElementById('qIncidentDate'); if(date){const d=new Date();date.value=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
  document.getElementById('modalCancel').onclick=closeModal;
  let selectedComplaintFiles=[];
  const fileInput=document.getElementById('qFiles');
  const fileList=document.getElementById('qFileList');
  const renderComplaintFiles=()=>{
    if(!fileList)return;
    fileList.innerHTML=selectedComplaintFiles.length?selectedComplaintFiles.map((f,i)=>`<span class="file-chip">${String(f.type||'').startsWith('image/')?'🖼️':'📎'} ${esc(f.name)} <button type="button" class="file-chip-remove" data-file-index="${i}" aria-label="Quitar archivo">×</button></span>`).join(''):'<span class="muted">No hay archivos seleccionados.</span>';
    fileList.querySelectorAll('[data-file-index]').forEach(btn=>btn.onclick=()=>{selectedComplaintFiles.splice(Number(btn.dataset.fileIndex),1);renderComplaintFiles();});
  };
  fileInput?.addEventListener('change',e=>{
    const incoming=Array.from(e.target.files||[]);
    for(const f of incoming){
      if(selectedComplaintFiles.length>=15)break;
      const duplicate=selectedComplaintFiles.some(x=>x.name===f.name&&x.size===f.size&&x.lastModified===f.lastModified);
      if(!duplicate)selectedComplaintFiles.push(f);
    }
    e.target.value='';
    renderComplaintFiles();
  });
  renderComplaintFiles();
  document.getElementById('modalSave').onclick=async()=>{try{
    const payload={incidentDate:document.getElementById('qIncidentDate').value,advisorCode:document.getElementById('qAdvisorCode')?.value||'',clientCode:document.getElementById('qClientCode').value.trim(),labelCode:document.getElementById('qLabelCode').value.trim(),area:document.getElementById('qArea').value.trim()||'logistica',subject:document.getElementById('qSubject').value.trim(),priority:document.getElementById('qPriority').value,detail:document.getElementById('qDetail').value.trim(),evidence:document.getElementById('qEvidence').value.trim()};
    if(!payload.incidentDate||!payload.subject||!payload.detail)throw new Error('Completa fecha, tipo de incidencia y detalle');
    if(selectedComplaintFiles.length>15)throw new Error('Puedes adjuntar máximo 15 archivos por incidencia');
    const fd=new FormData();Object.entries(payload).forEach(([k,v])=>fd.append(k,v));selectedComplaintFiles.forEach(f=>fd.append('files',f));
    const headers={};if(session?.token)headers.Authorization=`Bearer ${session.token}`;const res=await fetch('/api/quejas',{method:'POST',headers,body:fd});const text=await res.text();let data={};try{data=text?JSON.parse(text):{}}catch{throw new Error(text||'Respuesta no válida')};if(!res.ok)throw new Error(data.error||'No se pudo registrar la incidencia');await loadRemote();closeModal();renderView();toast(`Incidencia enviada${selectedComplaintFiles.length?` con ${selectedComplaintFiles.length} archivo(s)`:''}`);
  }catch(e){toast(e.message)}}
}
async function downloadComplaintFile(complaintId,fileId,fileName){try{const headers={};if(session?.token)headers.Authorization=`Bearer ${session.token}`;const res=await fetch(`/api/quejas/${complaintId}/archivos/${fileId}`,{headers});if(!res.ok)throw new Error('No se pudo descargar el archivo');const blob=await res.blob();const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=fileName||'archivo';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),500);}catch(e){toast(e.message)}}
async function downloadComplaintPdf(id){try{const headers={};if(session?.token)headers.Authorization=`Bearer ${session.token}`;const res=await fetch(`/api/quejas/${id}/pdf`,{headers});if(!res.ok)throw new Error('No se pudo generar el PDF');const blob=await res.blob();const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`INC-${String(id).replace(/^q/,'').padStart(4,'0')}.pdf`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),500);}catch(e){toast(e.message)}}
function historyModal(){if(me()?.role!=='admin')return toast('Solo el administrador puede ver la actividad reciente');const items=[...db.history].sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));openModal('Historial de actividad',`<div class="history-full">${items.length?items.map(h=>`<div class="history-row"><div class="history-icon">✓</div><div><b>${esc(h.action||'Cambio')}</b><p>${esc(h.description||h.action||'Sin detalle')}</p><small>${esc(userName(h.userId))} · ${fmtDT(h.createdAt)}</small></div></div>`).join(''):'<div class="empty">No hay actividad registrada.</div>'}</div>`,`<button class="btn btn-secondary" id="modalCancel">Cerrar</button>`);document.getElementById('modalCancel').onclick=closeModal}
function complaintsView(){
  const admin=me()?.role==='admin';
  const qs=db.complaints||[];
  if(!admin){
    return `<div class="page-head"><div><h1>Reportar incidencia</h1><p>Registra incidencias operativas y consulta las respuestas de administración.</p></div><button class="btn btn-primary" id="newComplaint">+ Nueva incidencia</button></div>
    <div class="card section"><div class="privacy-callout"><b>🔒 Canal privado</b><p>Solo tú y administración pueden consultar estas incidencias.</p></div>
    <div class="complaint-list">${qs.length?qs.map(q=>`<article class="complaint-card"><div class="complaint-card-head"><div><span class="code-pill">INC-${String(q.id).replace(/^q/,'').padStart(4,'0')}</span><h3>${esc(q.subject)}</h3><small>${fmtDate(q.createdAt)} · ${esc(q.area||'logistica')}</small></div><span class="badge ${q.status==='pendiente'?'pending':q.status==='en_revision'?'process':'done'}">${esc(q.status||'pendiente')}</span></div><div class="complaint-summary-grid"><div><b>Código cliente</b><span>${esc(q.clientCode||'—')}</span></div><div><b>Código etiqueta</b><span>${esc(q.labelCode||'—')}</span></div><div><b>Impacto</b><span>${esc(q.priority||'—')}</span></div></div><div class="complaint-detail"><b>Detalle</b><p>${esc(q.detail)}</p></div>${q.attachments?.length?`<div class="complaint-detail"><b>Adjuntos</b><div class="attachment-list">${q.attachments.map(a=>`<button type="button" class="attachment-chip" data-complaint-file="${q.id}" data-file-id="${a.id}" data-file-name="${esc(a.name)}">📎 ${esc(a.name)}</button>`).join('')}</div></div>`:''}${q.response?`<div class="complaint-response"><b>Respuesta de administración</b><p>${esc(q.response)}</p><small>${q.respondedAt?fmtDT(q.respondedAt):''}</small></div>`:'<div class="complaint-awaiting">⏳ Pendiente de respuesta de administración.</div>'}<div class="row" style="margin-top:10px"><button class="btn btn-secondary btn-sm" data-complaint-pdf="${q.id}">Descargar PDF</button></div></article>`).join(''):'<div class="empty">Todavía no has registrado incidencias.</div>'}</div></div>`;
  }
  return `<div class="page-head"><div><h1>Incidencias operativas</h1><p>Revisa, gestiona y responde los reportes enviados por las asesoras.</p></div></div><div class="card section"><div class="table-wrap"><table class="table"><thead><tr><th>Incidencia</th><th>Fecha</th><th>Asesora</th><th>Cliente / Etiqueta</th><th>Área</th><th>Impacto</th><th>Estado</th><th></th></tr></thead><tbody>${qs.map(q=>`<tr><td><b>INC-${String(q.id).replace(/^q/,'').padStart(4,'0')}</b><div class="muted">${esc(q.subject)}</div></td><td>${fmtDate(q.createdAt)}</td><td>${esc(userName(q.userId))}<div class="muted">${esc(q.advisorCode||'')}</div></td><td>${esc(q.clientCode||'—')}<div class="muted">${esc(q.labelCode||'')}</div></td><td>${esc(q.area||'logistica')}</td><td><span class="priority ${esc(q.priority)}">${esc(q.priority)}</span></td><td><span class="badge ${q.status==='pendiente'?'pending':q.status==='en_revision'?'process':'done'}">${esc(q.status||'pendiente')}</span></td><td><button class="btn btn-secondary btn-sm" data-action="complaint-view" data-id="${q.id}">Ver / responder</button> <button class="btn btn-secondary btn-sm" data-complaint-pdf="${q.id}">PDF</button></td></tr>`).join('')||'<tr><td colspan="8"><div class="empty">No hay incidencias.</div></td></tr>'}</tbody></table></div></div>`;
}
function normalizeClientAttentionStatus(value){
  const v=String(value??'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  return v;
}
function clientAttentionIsReusable(c){
  const v=normalizeClientAttentionStatus(c?.status);
  return v==='inactive'||v==='inactivo'||v==='done'||v==='atendido';
}
function labelIsClosed(label){
  const v=normalizeClientAttentionStatus(label?.status);
  return v==='closed'||v==='cerrada'||v==='cerrado';
}
function dateOnlyTimestamp(v){
  if(!v)return 0;
  const s=String(v).trim();
  const direct=Date.parse(s.length===10?s+'T00:00:00':s);
  return Number.isFinite(direct)?direct:0;
}
function clientReusableInfo(c, labels, containers, now=Date.now()){
  // Regla 1: estado del cliente atendido/inactivo => entra de inmediato, sin esperar 30 días.
  if(clientAttentionIsReusable(c)){
    const base=dateOnlyTimestamp(c?.updatedAt||c?.createdAt||c?.firstContactDate);
    const days=base?Math.max(0,Math.floor((now-base)/86400000)):0;
    return {reusable:true,reason:'Estado de cliente',detail:normalizeClientAttentionStatus(c?.status)==='done'?'Atendido':'Inactivo',lastDate:base,days};
  }

  // Regla 2: una etiqueta cerrada entra cuando su ETA (fecha de cierre) tiene 30 días o más.
  const closedCandidates=(labels||[])
    .filter(l=>sameRefId(l?.clientId,c?.id)&&labelIsClosed(l))
    .map(l=>{
      const container=(containers||[]).find(co=>sameRefId(co?.id,l?.containerId));
      const eta=dateOnlyTimestamp(container?.eta);
      return eta?{label:l,container,eta,days:Math.max(0,Math.floor((now-eta)/86400000))}:null;
    })
    .filter(Boolean)
    .filter(x=>x.days>=30)
    .sort((a,b)=>a.eta-b.eta);

  if(closedCandidates.length){
    const x=closedCandidates[0];
    return {reusable:true,reason:'Etiqueta cerrada',detail:`ETA ${fmtDate(new Date(x.eta))}`,lastDate:x.eta,days:x.days,labelNumber:x.label?.number||''};
  }
  return {reusable:false};
}
function reportsView(){
  if(me()?.role!=='admin') return '<div class="empty">No autorizado.</div>';
  const cs=Array.isArray(db.clients)?db.clients:[];
  const ls=Array.isArray(db.labels)?db.labels:[];
  const containers=Array.isArray(db.containers)?db.containers:[];
  const now=Date.now();
  const oldClients=cs.map(c=>{
    const info=clientReusableInfo(c,ls,containers,now);
    return info.reusable?{...c,...info,advisorName:userName(c.advisorId)}:null;
  }).filter(Boolean).sort((a,b)=>{
    const aImmediate=clientAttentionIsReusable(a)?1:0;
    const bImmediate=clientAttentionIsReusable(b)?1:0;
    if(aImmediate!==bImmediate)return bImmediate-aImmediate;
    if((b.days||0)!==(a.days||0))return (b.days||0)-(a.days||0);
    return String(a.name||'').localeCompare(String(b.name||''));
  });
  return `<div class="page-head"><div><h1>Reportes</h1><p>Indicadores rápidos del equipo y la operación.</p></div><div class="export-actions"><button class="btn btn-secondary" id="exportClientsCsv">Exportar clientes CSV</button><button class="btn btn-secondary" id="exportLabelsCsv">Exportar etiquetas CSV</button><button class="btn btn-secondary" id="exportContainersCsv">Exportar contenedores CSV</button></div></div>
  <div class="card section"><h3>Clientes por asesora</h3><div class="table-wrap"><table class="table"><thead><tr><th>Asesora</th><th>Clientes</th><th>Pendientes</th><th>En proceso</th><th>Etiquetas</th></tr></thead><tbody>${db.users.filter(u=>u.role==='asesora'&&u.active).map(u=>{const x=cs.filter(c=>sameRefId(c.advisorId,u.id)),labs=ls.filter(l=>x.some(c=>sameRefId(c.id,l.clientId)));return `<tr><td>${esc(u.name)}</td><td>${x.length}</td><td>${x.filter(c=>normalizeClientAttentionStatus(c.status)==='pending').length}</td><td>${x.filter(c=>normalizeClientAttentionStatus(c.status)==='process').length}</td><td>${labs.length}</td></tr>`}).join('')}</tbody></table></div></div>
  <div class="card section"><div class="row between"><div><h3>Clientes viejos reusables</h3><p class="muted-line">Entra de inmediato si el cliente está <b>Atendido</b> o <b>Inactivo</b>. También entra si tiene una <b>etiqueta Cerrada</b> cuyo ETA tenga 30 días o más.</p></div><span class="badge ${oldClients.length?'pending':'done'}">${oldClients.length} para recuperar</span></div>${oldClients.length?`<div class="table-wrap"><table class="table"><thead><tr><th>Cliente</th><th>Asesora</th><th>Estado</th><th>Motivo</th><th>Fecha de referencia</th><th>Tiempo</th><th></th></tr></thead><tbody>${oldClients.map(c=>`<tr><td><b>${esc(c.name)}</b><div class="muted">${esc(c.code||'')}</div></td><td>${esc(c.advisorName)}</td><td>${badgeStatus('client',c.status)}</td><td>${esc(c.reason)}${c.labelNumber?`<div class="muted">${esc(c.labelNumber)}</div>`:''}</td><td>${c.lastDate?fmtDate(new Date(c.lastDate)):'—'}</td><td>${c.days} ${c.days===1?'día':'días'}</td><td><div class="row"><button class="btn btn-secondary btn-sm" data-old-client-open="${esc(c.id)}">Ver en Clientes</button><button class="btn btn-primary btn-sm" data-old-client-reminder="${esc(c.id)}">🔔 Recordar a asesora</button></div></td></tr>`).join('')}</tbody></table></div>`:`<div class="empty">No hay clientes que cumplan el criterio en este momento.</div>`}</div>
  <div class="card section"><h3>Contenedores</h3><div class="table-wrap"><table class="table"><thead><tr><th>Contenedor</th><th>Estado</th><th>Clientes</th><th>Etiquetas</th><th>ETA</th></tr></thead><tbody>${containers.map(c=>{const l=ls.filter(x=>sameRefId(x.containerId,c.id));return `<tr><td>${esc(c.number)}</td><td>${badgeStatus('container',c.status)}</td><td>${new Set(l.map(x=>x.clientId)).size}</td><td>${l.length}</td><td>${fmtDate(c.eta)}</td></tr>`}).join('')}</tbody></table></div></div>`;
}
function backupsView(){
  if(me()?.role!=='admin') return '<div class="empty">No autorizado.</div>';
  return `<div class="page-head"><div><h1>Hacer copia de seguridad</h1><p>Descarga una copia local de la información principal de Ladin Cloud.</p></div><button class="btn btn-primary" id="downloadCsvBackup">💾 Descargar copia</button></div>
  <div class="card section backup-panel"><div class="backup-hero"><div class="backup-icon">💾</div><div><span class="backup-kicker">COPIA LOCAL</span><h2>Clientes, etiquetas y contenedores</h2><p>Al descargar se genera un ZIP con 3 archivos CSV separados: <b>clientes.csv</b>, <b>etiquetas.csv</b> y <b>contenedores.csv</b>. La copia se genera en el servidor y se descarga directamente a la computadora del administrador.</p></div></div><div class="backup-meta-grid"><div class="card stat"><div class="label">Formato</div><div class="num small">ZIP + 3 CSV</div></div><div class="card stat"><div class="label">Acceso</div><div class="num small">Solo administradores</div></div></div><div class="section-callout"><div><b>Importante</b><p>Esta copia exporta los 3 conjuntos de datos solicitados. No reemplaza un respaldo completo de PostgreSQL.</p></div></div></div>`;
}

function usersView(){if(me()?.role!=='admin')return '<div class="empty">No autorizado.</div>';const advisors=db.users.filter(u=>u.role==='asesora'&&u.active);const inactiveAdvisors=db.users.filter(u=>u.role==='asesora'&&!u.active);return `<div class="page-head"><div><h1>Equipo</h1><p>Gestiona administradores, asesoras y la distribución de carteras.</p></div><button class="btn btn-primary" id="newUser">+ Nuevo usuario</button></div><div class="card section"><div class="team-grid">${advisors.map(u=>{const n=db.clients.filter(c=>c.advisorId===u.id).length;const l=db.labels.filter(x=>db.clients.some(c=>c.id===x.clientId&&c.advisorId===u.id)).length;return `<div class="team-card"><div class="team-avatar">${esc((u.name||'U').split(' ').map(x=>x[0]).slice(0,2).join('').toUpperCase())}</div><div class="team-info"><div class="team-top"><div><h3>${esc(u.name)}</h3><p>${esc(u.email)}</p></div>${u.active?badgeStatus('client','done'):badgeStatus('client','inactive')}</div><div class="advisor-code"><span>Código de asesora</span><b class="code-pill">${esc(u.advisorCode||'ASE-'+String(u.id).replace(/\D/g,'').padStart(3,'0'))}</b></div><div class="team-metrics"><span><b>${n}</b> clientes</span><span><b>${l}</b> etiquetas</span></div><div class="team-actions"><button class="btn btn-secondary btn-sm" data-action="user-edit" data-id="${u.id}">Editar</button><button class="btn btn-primary btn-sm" data-action="user-reassign" data-id="${u.id}">Reasignar cartera</button><button class="btn btn-danger btn-sm" data-action="user-delete" data-id="${u.id}">Eliminar</button></div></div></div>`}).join('')}</div></div><div class="card section"><div class="section-callout"><div><b>Reasignación inteligente</b><p>Al mover clientes a otra asesora, sus etiquetas permanecen vinculadas automáticamente al cliente.</p></div><button class="btn btn-secondary" id="openReassign">Reasignar clientes</button></div></div><div class="card section"><h3>Administradores</h3><div class="table-wrap"><table class="table"><thead><tr><th>Nombre</th><th>Correo</th><th>Estado</th><th></th></tr></thead><tbody>${db.users.filter(u=>u.role==='admin').map(u=>`<tr><td><b>${esc(u.name)}</b></td><td>${esc(u.email)}</td><td>${u.active?badgeStatus('client','done'):badgeStatus('client','inactive')}</td><td><div class="row"><button class="btn btn-secondary btn-sm" data-action="user-edit" data-id="${u.id}">Editar</button>${u.id!==me()?.id?`<button class="btn btn-danger btn-sm" data-action="user-delete" data-id="${u.id}">Eliminar</button>`:''}</div></td></tr>`).join('')}</tbody></table></div></div>`}

function complaintAdminModal(q){
  openModal(`Incidencia INC-${String(q.id).replace(/^q/,'').padStart(4,'0')}`,`
    <div class="complaint-admin-sheet">
      <div class="complaint-admin-head"><div><span class="modal-kicker">Registro de incidencia operativa</span><h3>${esc(q.subject)}</h3><p>${fmtDate(q.createdAt)} · ${esc(q.area||'logistica')}</p></div><span class="badge ${q.status==='pendiente'?'pending':q.status==='en_revision'?'process':'done'}">${esc(q.status||'pendiente')}</span></div>
      <div class="complaint-summary-grid"><div><b>Número</b><span>INC-${String(q.id).replace(/^q/,'').padStart(4,'0')}</span></div><div><b>Código Asesor</b><span>${esc(q.advisorCode||'—')}</span></div><div><b>Asesora</b><span>${esc(userName(q.userId))}</span></div><div><b>Código Cliente</b><span>${esc(q.clientCode||'—')}</span></div><div><b>Código Etiqueta</b><span>${esc(q.labelCode||'—')}</span></div><div><b>Área</b><span>${esc(q.area||'logistica')}</span></div><div><b>Impacto</b><span>${esc(q.priority||'—')}</span></div></div>
      <div class="complaint-detail"><b>Detalle de la situación</b><p>${esc(q.detail)}</p></div>
      <div class="complaint-detail"><b>Evidencia / soporte</b><p>${esc(q.evidence||'No indicada')}</p></div>${q.attachments?.length?`<div class="complaint-detail"><b>Archivos adjuntos</b><div class="attachment-list">${q.attachments.map(a=>`<button type="button" class="attachment-chip" data-complaint-file="${q.id}" data-file-id="${a.id}" data-file-name="${esc(a.name)}">📎 ${esc(a.name)}</button>`).join('')}</div></div>`:''}
      ${q.response?`<div class="complaint-response"><b>Respuesta actual</b><p>${esc(q.response)}</p><small>${q.respondedAt?fmtDT(q.respondedAt):''}</small></div>`:''}
      <div class="form-grid">${selectField('qStatus','Estado',[['pendiente','Pendiente'],['en_revision','En revisión'],['respondida','Respondida'],['resuelta','Resuelta']],q.status||'pendiente')}</div>
      <div class="field"><label>Respuesta del administrador</label><textarea id="qResponse" rows="7" placeholder="Escribe una respuesta clara para la asesora...">${esc(q.response||'')}</textarea></div>
    </div>`,`<button class="btn btn-secondary" id="modalCancel">Cerrar</button><button class="btn btn-secondary" id="modalPdf">Descargar PDF</button><button class="btn btn-primary" id="modalSave">Guardar respuesta</button>`);
  document.getElementById('modalPdf').onclick=()=>downloadComplaintPdf(q.id);
  document.getElementById('modalCancel').onclick=closeModal;
  document.getElementById('modalSave').onclick=async()=>{try{const response=document.getElementById('qResponse').value.trim();let status=document.getElementById('qStatus').value;if(response&&status==='pendiente')status='respondida';const data=await api(`/api/quejas/${q.id}`,{method:'PUT',body:JSON.stringify({status,response})});const i=(db.complaints||[]).findIndex(x=>x.id===q.id);if(i>=0)db.complaints[i]=data;closeModal();renderView();toast('Respuesta guardada correctamente')}catch(e){toast(e.message)}}
}

function globalSearchItems(){
  const q=searchTerm.trim().toLowerCase();
  if(!q)return [];
  const u=me(), out=[];
  const clients=scopedClients();
  clients.forEach(c=>{const hay=[c.code,c.name,c.phone,c.email,c.company,c.state,c.notes].join(' ').toLowerCase();if(hay.includes(q))out.push({kind:'Cliente',icon:'👤',title:c.name,meta:[c.code,c.company,c.phone].filter(Boolean).join(' · '),view:'clients',id:c.id,action:'client-view'});});
  scopedLabels().forEach(l=>{const hay=[l.number,clientName(l.clientId),containerName(l.containerId),l.status,l.notes].join(' ').toLowerCase();if(hay.includes(q))out.push({kind:'Etiqueta',icon:'🏷️',title:l.number,meta:[clientName(l.clientId),containerName(l.containerId)].filter(x=>x&&x!=='Sin cliente'&&x!=='Sin contenedor').join(' · '),view:'labels',id:l.id,action:'label-edit'});});
  scopedContainers().forEach(c=>{const hay=[c.number,c.origin,c.notes,c.departure,c.eta,c.arrival].join(' ').toLowerCase();if(hay.includes(q))out.push({kind:'Contenedor',icon:'🚢',title:c.number,meta:[c.origin,fmtDate(c.departure),fmtDate(c.eta)].filter(Boolean).join(' · '),view:'containers',id:c.id,action:'container-view'});});
  (db.reminders||[]).filter(r=>u?.role==='admin'||r.advisorId===u?.id).forEach(r=>{const hay=[r.title,r.notes,clientName(r.clientId),r.dueAt].join(' ').toLowerCase();if(hay.includes(q))out.push({kind:'Recordatorio',icon:'🔔',title:r.title,meta:[clientName(r.clientId),fmtDT(r.dueAt)].filter(Boolean).join(' · '),view:'reminders',id:r.id,action:'reminder'});});
  if(u?.role==='admin'){
    db.users.filter(x=>x.active).forEach(x=>{const hay=[x.name,x.email,x.role].join(' ').toLowerCase();if(hay.includes(q))out.push({kind:'Usuario',icon:'⚙️',title:x.name,meta:x.email,view:'users',id:x.id,action:'user-edit'});});
    (db.complaints||[]).forEach(x=>{const hay=[x.subject,x.detail,x.response,x.priority,x.status,userName(x.userId)].join(' ').toLowerCase();if(hay.includes(q))out.push({kind:'Queja',icon:'💬',title:x.subject,meta:[userName(x.userId),x.status].filter(Boolean).join(' · '),view:'complaints',id:x.id,action:'complaint-view'});});
  }
  return out.slice(0,12);
}
function renderGlobalSearch(){
  const box=document.getElementById('globalSearchResults'); if(!box)return;
  const q=searchTerm.trim();
  if(!q){box.classList.remove('show');box.innerHTML='';return;}
  const items=globalSearchItems();
  box.innerHTML=items.length?items.map(x=>`<button type="button" class="global-search-item" data-search-view="${x.view}" data-search-action="${x.action}" data-search-id="${x.id}"><span class="global-search-icon">${x.icon}</span><span class="global-search-copy"><b>${esc(x.title)}</b><small>${esc(x.kind)}${x.meta?' · '+esc(x.meta):''}</small></span></button>`).join(''):`<div class="global-search-empty">No encontramos coincidencias para <b>${esc(q)}</b>.</div>`;
  box.classList.add('show');
  box.querySelectorAll('[data-search-view]').forEach(b=>b.onclick=()=>{
    const view=b.dataset.searchView, action=b.dataset.searchAction, id=b.dataset.searchId;
    searchTerm=''; box.classList.remove('show'); box.innerHTML='';
    if(action==='reminder'){currentView=view;renderView();setTimeout(()=>{const r=(db.reminders||[]).find(x=>String(x.id)===String(id));if(r)reminderModal(r)},0);return;}
    currentView=view;renderView();
    setTimeout(()=>handleAction(action,id),0);
  });
}
function bindGlobal(){document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{currentView=b.dataset.view;searchTerm='';renderView()});document.getElementById('logoutBtn')?.addEventListener('click',()=>{session=null;safeRemove(SESSION);mount()});document.getElementById('loginBtn')?.addEventListener('click',login);document.getElementById('loginPass')?.addEventListener('keydown',e=>{if(e.key==='Enter')login()});document.getElementById('newComplaintQuick')?.addEventListener('click',()=>me()?.role==='admin'?(currentView='complaints',renderView()):complaintModal())}

async function loadPortfolioData(advisorId){
  portfolioLoading=true; portfolioRemote=null; renderView();
  try{
    const q=advisorId?`?advisorId=${encodeURIComponent(String(advisorId).replace(/[^0-9]/g,''))}`:'';
    portfolioRemote=await api('/api/portfolio'+q);
  }catch(err){ portfolioRemote={error:err.message||'No se pudo cargar la cartera'}; }
  finally{ portfolioLoading=false; renderView(); }
}
function updateClientRows(term=''){const tbody=document.getElementById('clientsTableBody');if(!tbody)return;let cs=sortByRecency(scopedClients(),clientSortOrder);const q=String(term||'').trim().toLowerCase();if(q)cs=cs.filter(c=>`${c.code||''} ${c.name||''} ${c.phone||''} ${c.email||''} ${c.company||''}`.toLowerCase().includes(q));if(me()?.role==='admin'&&window.clientPageAdvisorFilter)cs=cs.filter(c=>sameRefId(c.advisorId,window.clientPageAdvisorFilter));tbody.innerHTML=legacyClientRowsHTML(cs);tbody.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>handleAction(b.dataset.action,b.dataset.id))}
function updateLabelRows(term=''){const host=document.getElementById('labelSearchResults');if(!host)return;let ls=scopedLabels();const q=String(term||'').trim().toLowerCase();if(q)ls=ls.filter(l=>`${l.number||''} ${clientName(l.clientId)||''} ${containerName(l.containerId)||''} ${l.familyCode||''}`.toLowerCase().includes(q));host.innerHTML=renderLabelsByClient(ls);host.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>handleAction(b.dataset.action,b.dataset.id))}
function bindClientPageTools(){const i=document.getElementById('clientPageSearch');const btn=document.getElementById('clientPageSearchBtn');const run=()=>{clientPageSearchValue=String(i?.value||'');updateClientRows(clientPageSearchValue)};if(i){i.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();run()}})}if(btn)btn.addEventListener('click',run);const s=document.getElementById('clientAdvisorFilter');if(s)s.addEventListener('change',()=>{window.clientPageAdvisorFilter=s.value;updateClientRows(clientPageSearchValue)})}
function bindLabelsPageTools(){const i=document.getElementById('labelPageSearch');if(i)i.addEventListener('input',()=>{const value=String(i.value||'');labelPageSearchValue=value;updateLabelRows(value)});}

function bindSortControls(){document.querySelectorAll('[data-sort-type]').forEach(b=>b.addEventListener('click',()=>{const type=b.dataset.sortType;const order=b.dataset.sortOrder||'desc';if(type==='client')clientSortOrder=order;else labelSortOrder=order;renderView()}));}

async function loadBackupStatus(){ return; }
async function downloadCsvBackup(){
  const btn=document.getElementById('downloadCsvBackup'); if(!btn)return;
  btn.disabled=true; btn.textContent='⏳ Preparando copia...';
  try{
    const headers={}; if(session?.token) headers.Authorization=`Bearer ${session.token}`;
    const res=await fetch('/api/admin/backup-csv.zip',{headers,cache:'no-store'});
    if(!res.ok){ const text=await res.text(); let msg='No se pudo generar la copia'; try{msg=JSON.parse(text).error||msg;}catch{} throw new Error(msg); }
    const blob=await res.blob();
    const cd=res.headers.get('Content-Disposition')||''; const match=cd.match(/filename="([^"]+)"/i);
    const filename=match?.[1]||`LadinCloud_Backup_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.zip`;
    const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000); toast('Copia descargada correctamente');
  }catch(e){toast(e.message||'No se pudo descargar la copia');}
  finally{btn.disabled=false; btn.textContent='💾 Descargar copia';}
}

function bindView(){
  document.querySelectorAll('#page [data-view]').forEach(b=>b.onclick=()=>{currentView=b.dataset.view;renderView()});
  setupSalesQuotes();bindClientPageTools();document.getElementById('newClient')?.addEventListener('click',()=>clientModal());document.getElementById('newLabel')?.addEventListener('click',()=>labelModal());document.getElementById('newContainer')?.addEventListener('click',()=>containerModal());document.getElementById('newUser')?.addEventListener('click',()=>userModal());document.getElementById('downloadCsvBackup')?.addEventListener('click',downloadCsvBackup);document.getElementById('openReassign')?.addEventListener('click',()=>reassignModal());document.getElementById('newComplaint')?.addEventListener('click',()=>complaintModal());document.getElementById('openHistory')?.addEventListener('click',()=>historyModal());document.getElementById('exportClientsCsv')?.addEventListener('click',exportClientsCsv);document.getElementById('exportLabelsCsv')?.addEventListener('click',exportLabelsCsv);document.getElementById('exportContainersCsv')?.addEventListener('click',exportContainersCsv);document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>handleAction(b.dataset.action,b.dataset.id));document.querySelectorAll('[data-complaint-pdf]').forEach(b=>b.onclick=()=>downloadComplaintPdf(b.dataset.complaintPdf));document.querySelectorAll('[data-old-client-open]').forEach(b=>b.onclick=()=>{const c=db.clients.find(x=>String(x.id)===String(b.dataset.oldClientOpen));if(!c)return;clientPageSearchValue=String(c.code||c.name||'');currentView='clients';renderView()});document.querySelectorAll('[data-old-client-reminder]').forEach(b=>b.onclick=()=>{const c=db.clients.find(x=>String(x.id)===String(b.dataset.oldClientReminder));if(c){const info=clientReusableInfo(c,db.labels||[],db.containers||[],Date.now());const note=info.reason==='Estado de cliente'?`Cliente ${info.detail.toLowerCase()} detectado como reutilizable. Escribir para reactivar la relación comercial.`:`Cliente con etiqueta cerrada (${info.labelNumber||'sin número'}) cuyo ETA fue ${info.lastDate?fmtDate(new Date(info.lastDate)):'hace 30 días o más'}. Escribir para reactivar la relación comercial.`;reminderModal({title:`Reactivar cliente: ${c.name}`,advisorId:c.advisorId,clientId:c.id,dueAt:new Date(Date.now()+86400000).toISOString(),notes:note,completed:false});}});document.getElementById('openPortfolio')?.addEventListener('click',()=>{currentView='portfolio';renderView()});const portfolioAdvisor=document.getElementById('portfolioAdvisorFilter'); if(portfolioAdvisor){ const onAdvisorChange=async e=>{portfolioAdvisorFilter=String(e.target.value||'');portfolioClientFilter='';const meta=document.getElementById('portfolioAdvisorMeta');if(meta)meta.textContent=portfolioAdvisorFilter?'Cargando clientes…':'Elige una asesora para cargar su cartera.';try{if(portfolioAdvisorFilter)await loadRemote();}catch(err){toast(err.message||'No se pudo actualizar la cartera');}renderView();}; portfolioAdvisor.addEventListener('change',onAdvisorChange); } const portfolioClient=document.getElementById('portfolioClientFilter'); if(portfolioClient){ const onClientChange=e=>{portfolioClientFilter=String(e.target.value||'');renderView();}; portfolioClient.addEventListener('change',onClientChange); }}
async function login(){const email=document.getElementById('loginEmail').value.trim().toLowerCase(),pass=document.getElementById('loginPass').value,err=document.getElementById('loginErr');err.textContent='';try{const data=await api('/api/auth/login',{method:'POST',body:JSON.stringify({email,password:pass})});session={userId:data.user.id,token:data.token};localStorage.setItem(SESSION,JSON.stringify(session));db=data.bootstrap;currentView='dashboard';mount()}catch(e){err.textContent=e.message||'No se pudo iniciar sesión.'}}
function openModal(title,body,footer=''){const m=document.getElementById('modal');m.innerHTML=`<div class="modal-card"><div class="modal-head"><h2>${title}</h2><button class="icon-btn" id="closeModal">×</button></div><div class="modal-body">${body}</div><div class="modal-foot">${footer}</div></div>`;m.classList.add('show');document.getElementById('closeModal').onclick=closeModal}
function closeModal(){const m=document.getElementById('modal');m.classList.remove('show');m.innerHTML=''}
function field(id,label,val='',type='text',extra=''){return `<div class="field"><label>${label}</label><input id="${id}" type="${type}" value="${esc(val)}" ${extra}></div>`}
function selectField(id,label,options,value=''){return `<div class="field"><label>${label}</label><select id="${id}">${options.map(o=>`<option value="${esc(o[0])}" ${o[0]===value?'selected':''}>${esc(o[1])}</option>`).join('')}</select></div>`}
function applyLabelStatusColors(){const el=document.getElementById('mStatus');if(!el)return;el.classList.remove('status-select');el.style.backgroundColor='#FFFFFF';el.style.color='#152033';el.style.borderColor='#DCE2EC';Array.from(el.options).forEach(o=>{o.style.backgroundColor='#FFFFFF';o.style.color='#152033'});}
function clientModal(existing=null){const c=existing||{};const opts=db.users.filter(u=>u.role==='asesora'&&u.active).map(u=>[u.id,`${u.name}${u.advisorCode?' · '+u.advisorCode:''}`]);if(me()?.role==='admin')opts.unshift([me().id,`${me().name} (Administrador)`]);const advisor=c.advisorId||opts[0]?.[0]||'';const stateOptions=[['','Selecciona el estado'],...VENEZUELA_STATES.map(x=>[x,x])];const labels=existing?db.labels.filter(l=>String(l.clientId)===String(existing.id)):[];const labelRows=labels.length?labels.map(l=>`<div class="purchase-row"><span class="code-pill">${esc(l.number)}</span><span>${badgeStatus('label',l.status)}</span><button class="btn btn-secondary btn-sm" data-action="label-view" data-id="${l.id}">Ver detalles</button></div>`).join(''):'<div class="empty compact">Sin etiquetas registradas.</div>';openModal(existing?'Editar cliente':'Nuevo cliente',`<div class="modal-intro"><span class="modal-kicker">${existing?'Actualizar':'Registrar'}</span><h3>${existing?'Información del cliente':'Nuevo cliente'}</h3><p>Completa los datos básicos de contacto e identificación del cliente.</p></div><div class="form-grid">${field('mCode','Código de cliente',c.code||'','text','placeholder="LC-CLI-000001"')}${field('mName','Nombre completo',c.name||'','text','required placeholder="Ej. María González"')}${field('mPhone','Teléfono',c.phone||'','text','placeholder="+58 ..."')}${field('mEmail','Correo',c.email||'','email','placeholder="cliente@correo.com"')}${field('mCompany','Empresa',c.company||'','text','placeholder="Empresa o negocio"')}${selectField('mState','Estado de Venezuela',stateOptions,c.state||'')}${selectField('mStatus','Estado de atención',[['process','Atendiendo'],['pending','Por atender'],['done','Atendido'],['inactive','Inactivo']],c.status||'pending')}${me()?.role==='admin'?selectField('mAdvisor','Asesora',opts,advisor):`<div class="field"><label>Asesora</label><input value="${esc(me()?.name||'')}" disabled></div>`}${field('mFirstContact','Fecha del primer contacto',c.firstContactDate||'','date')}${field('mAdvisorCode','Código de asesora',db.users.find(u=>String(u.id)===String(advisor))?.advisorCode||'','text','readonly')}${field('mNotes','Observaciones',c.notes||'','text','placeholder="Notas internas..."')}</div>${existing?`<div class="form-hint"><b>Etiquetas del cliente</b></div><div class="purchase-list">${labelRows}</div>`:''}`,`<button class="btn btn-secondary" id="modalCancel">Cancelar</button><button class="btn btn-primary" id="modalSave">${existing?'Guardar cambios':'Crear cliente'}</button>`);document.getElementById('modalCancel').onclick=closeModal;document.getElementById('mAdvisor')?.addEventListener('change',()=>{const id=document.getElementById('mAdvisor').value;document.getElementById('mAdvisorCode').value=db.users.find(u=>String(u.id)===String(id))?.advisorCode||''});document.querySelectorAll('#modal [data-action=label-view]').forEach(b=>b.onclick=()=>handleAction('label-view',b.dataset.id));document.getElementById('modalSave').onclick=async()=>{const p={code:document.getElementById('mCode').value.trim(),name:document.getElementById('mName').value.trim(),phone:document.getElementById('mPhone').value.trim(),email:document.getElementById('mEmail').value.trim(),company:document.getElementById('mCompany').value.trim(),state:document.getElementById('mState').value,status:document.getElementById('mStatus').value,firstContactDate:document.getElementById('mFirstContact').value,notes:document.getElementById('mNotes').value.trim()};if(me()?.role==='admin')p.advisorId=document.getElementById('mAdvisor').value;try{if(!p.name)throw new Error('El nombre es obligatorio');if(existing)await api(`/api/clientes/${existing.id}`,{method:'PUT',body:JSON.stringify(p)});else await api('/api/clientes',{method:'POST',body:JSON.stringify(p)});await loadRemote();closeModal();renderView();toast(existing?'Cliente actualizado':'Cliente creado correctamente')}catch(e){toast(e.message)}}}

function fallbackClientLabel(clientId){const c=db.clients.find(x=>sameRefId(x.id,clientId));return c?`${c.code||'—'} · ${c.name}`:''}
function resolveClientSearchValue(value){
  const v=String(value||'').trim().toLowerCase();
  if(!v)return null;
  const exact=db.clients.find(c=>`${c.code||'—'} · ${c.name}`.toLowerCase()===v || String(c.code||'').toLowerCase()===v || String(c.name||'').toLowerCase()===v);
  if(exact)return exact;
  const code=db.clients.find(c=>String(c.code||'').toLowerCase()===v);
  return code||null;
}
function bindClientSearch(){
  const wrap=document.getElementById('clientSelector');
  const input=document.getElementById('mClientSearch');
  const hidden=document.getElementById('mClient');
  const menu=document.getElementById('clientDropdown');
  if(!wrap||!input||!hidden||!menu)return;
  const clients=scopedClients();
  const renderMenu=(query='')=>{
    const q=String(query||'').trim().toLowerCase();
    const matches=clients.filter(c=>{
      const text=`${c.code||''} ${c.name||''} ${c.phone||''} ${c.company||''}`.toLowerCase();
      return !q||text.includes(q);
    }).slice(0,50);
    menu.innerHTML=matches.length?matches.map(c=>`<button type="button" class="client-option" data-client-id="${esc(c.id)}"><span class="client-option-main"><b>${esc(c.name)}</b><small>${esc(c.code||'Sin código')}${c.company?' · '+esc(c.company):''}</small></span><span class="client-option-arrow">›</span></button>`).join(''):`<div class="client-option-empty">No se encontraron clientes.</div>`;
    menu.querySelectorAll('[data-client-id]').forEach(btn=>btn.addEventListener('click',()=>{
      const c=clients.find(x=>String(x.id)===String(btn.dataset.clientId));
      if(!c)return;
      hidden.value=c.id;
      hidden.dispatchEvent(new Event('change'));
      input.value=fallbackClientLabel(c.id);
      input.classList.add('input-valid');
      menu.classList.remove('open');
    }));
  };
  const open=()=>{renderMenu(input.value);menu.classList.add('open');};
  input.addEventListener('focus',open);
  input.addEventListener('click',open);
  input.addEventListener('input',()=>{
    const c=resolveClientSearchValue(input.value);
    hidden.value=c?c.id:'';
    hidden.dispatchEvent(new Event('change'));
    input.classList.toggle('input-valid',!!c);
    renderMenu(input.value);
    menu.classList.add('open');
  });
  input.addEventListener('keydown',e=>{if(e.key==='Escape')menu.classList.remove('open');});
  document.addEventListener('click',e=>{if(!wrap.contains(e.target))menu.classList.remove('open');},{once:true});
  if(hidden.value){input.value=fallbackClientLabel(hidden.value);input.classList.add('input-valid');}
}

function labelModal(existing=null,presetClientId='',presetParentId=''){
  const l=existing||{};
  const currentClientId=l.clientId||presetClientId||'';
  const currentParentId=l.parentLabelId||presetParentId||'';
  const containers=db.containers.map(c=>[c.id,c.number]);
  const hasChildren=familyChildren(l).length>0;
  const isChild=!!currentParentId||!!l.parentLabelId;
  const parentOptions=()=>{const clientId=document.getElementById('mClient')?.value||currentClientId;const parents=scopedLabels().filter(x=>String(x.clientId)===String(clientId)&&!x.parentLabelId&&String(x.id)!==String(l.id||''));return [['','Etiqueta principal / sin subetiqueta'],...parents.map(x=>[x.id,`${x.number}`])];};
  const parentOpts=parentOptions();
  const nextSubNumber=(parentId)=>{const parent=db.labels.find(x=>sameRefId(x.id,parentId));const base=parent?.number||'Etiqueta';const nums=scopedLabels().filter(x=>String(x.parentLabelId)===String(parentId)).map(x=>{const m=String(x.number||'').match(/-(\d+)$/);return m?Number(m[1]):0;});return `${base}-${(nums.length?Math.max(...nums):0)+1}`;};

  const initialNumber=(isChild&&!existing&&currentParentId)?nextSubNumber(currentParentId):(l.number||'');
  const title=existing?'Editar compra / envío':isChild?'Nueva subetiqueta':'Nueva etiqueta';
  const intro=isChild?'Esta subetiqueta registra una llegada parcial vinculada a la etiqueta principal.':'Una etiqueta principal puede tener subetiquetas cuando las cajas o el CBM llegan en diferentes momentos.';
  const root=isChild?(db.labels.find(x=>sameRefId(x.id,currentParentId))||l):l;
  const rootExpected=Math.max(0,Number(root.boxesPacking||0));
  const rootBaseWarehouse=Math.max(0,Number(root.boxesChina||0));
  const siblingReceived=isChild?db.labels.filter(x=>sameRefId(x.parentLabelId,currentParentId)&&(!existing||!sameRefId(x.id,existing.id))).reduce((sum,x)=>sum+Math.max(0,Number(x.boxesPacking||0)),0):0;
  const parentAvailable=isChild?Math.max(rootExpected-rootBaseWarehouse-siblingReceived,0):0;
  const initialBoxesPacking=isChild?parentAvailable:(l.boxesPacking??'');
  const initialBoxesChina=isChild?parentAvailable:(l.boxesChina??'');
  const initialMissing=isChild?Math.max(parentAvailable-Number(l.boxesPacking??parentAvailable),0):Math.max(rootExpected-Number(rootBaseWarehouse),0);
  const rootCbmExpected=Math.max(0,Number(root.cbmPacking||0));
  const rootCbmReal=Math.max(0,Number(root.cbmChina||0));
  const siblingCbmReceived=isChild?db.labels.filter(x=>sameRefId(x.parentLabelId,currentParentId)&&(!existing||!sameRefId(x.id,existing.id))).reduce((sum,x)=>sum+Math.max(0,Number(x.cbmChina||0)),0):0;
  const cbmAvailable=isChild?Math.max(rootCbmExpected-rootCbmReal-siblingCbmReceived,0):0;
  const initialCbmPacking=isChild?cbmAvailable:(l.cbmPacking??'');
  const initialCbmMissing=isChild?Math.max(cbmAvailable-Number(l.cbmChina??0),0):Math.max(rootCbmExpected-rootCbmReal,0);
  openModal(title,`<div class="modal-intro"><span class="modal-kicker">Trazabilidad</span><h3>${existing?'Actualizar compra / envío':isChild?'Crear subetiqueta':'Crear compra / envío'}</h3><p>${intro}</p></div><div class="form-grid">${field('mNumber','Número de etiqueta',initialNumber,'text')}<div class="field client-search-field"><label for="mClientSearch">Cliente</label><div class="client-search-wrap" id="clientSelector"><input id="mClientSearch" type="text" autocomplete="off" value="${esc(currentClientId?fallbackClientLabel(currentClientId):'')}" placeholder="Escribe para buscar un cliente o selecciona de la lista"><button type="button" class="client-dropdown-toggle" id="clientDropdownToggle">▾</button><div id="clientDropdown" class="client-dropdown"></div><input id="mClient" type="hidden" value="${esc(currentClientId)}"></div></div><div class="field"><label>Etiqueta principal / subetiqueta</label><select id="mParentLabel">${parentOpts.map(([v,t])=>`<option value="${esc(v)}" ${String(v)===String(currentParentId)?'selected':''}>${esc(t)}</option>`).join('')}</select><small class="muted">Vincula esta subetiqueta a una etiqueta principal cuando corresponda.</small></div>${(!isChild)?`<label class="check-row family-main-check"><input type="checkbox" id="mHasSubLabels" ${l.isFamilyParent||hasChildren?'checked':''}><span><b>Esta etiqueta principal tendrá subetiquetas</b><small>Las cajas de las subetiquetas se acumularán automáticamente en la etiqueta principal.</small></span></label>`:''}${field('mCargoType','Tipo de mercancía',l.cargoType||'')}${selectField('mContainer','Contenedor (opcional)',[['','Sin contenedor'],...containers],l.containerId||'')}${selectField('mStatus','Estado',[['prep','Preparando'],['transit','En tránsito'],['ve','En Venezuela'],['facturado','Facturado'],['closed','Cerrado']],l.status||'prep')}${field('mBoxesPacking',isChild?'Cajas de esta subetiqueta':'Cajas totales del packing list',initialBoxesPacking,'number','min="0" step="1"')}${!isChild?'<div class="form-hint family-total-hint">Este valor define el total de cajas que deben corresponder a esta operación y sus subetiquetas.</div>':''}${field('mBoxesChina','Cajas en almacén',initialBoxesChina,'number','min="0" step="1"'+(isChild?' readonly':'') )}${field('mBoxesMissing','Cajas faltantes',initialMissing,'number','readonly')}${field('mCbmPacking','CBM del Packing List',initialCbmPacking,'number','min="0" step="0.001"'+(isChild?' readonly':''))}${field('mCbmChina',isChild?'CBM de esta subetiqueta':'CBM real recibido en almacén China',l.cbmChina??'','number','min="0" step="0.001"')}${field('mCbmMissing','CBM Faltante',initialCbmMissing,'number','readonly')}</div>${field('mNotes','Observaciones',l.notes||'')}${hasChildren?`<div class="form-hint family-progress-hint"><b>Etiqueta principal:</b> ${familyChildren(l).length} subetiqueta(s) · ${familySummary(l)?.registered||0} / ${familySummary(l)?.expected||0} cajas registradas · ${familySummary(l)?.progress||0}%</div>`:''}`,`<button class="btn btn-secondary" id="modalCancel">Cancelar</button><button class="btn btn-primary" id="modalSave">${existing?'Guardar cambios':isChild?'Crear subetiqueta':'Registrar compra / envío'}</button>`);
  bindClientSearch();
  const updateMissing=()=>{const bm=document.getElementById('mBoxesMissing');if(bm){const total=Number(String(document.getElementById('mBoxesPacking')?.value??'').replace(',','.'));const base=Number(String(document.getElementById('mBoxesChina')?.value??'').replace(',','.'));bm.value=Number.isFinite(total)?String(Math.max(Math.round((isChild?parentAvailable:total-(Number.isFinite(base)?base:0))),0)):'';if(isChild)bm.value=Number.isFinite(total)?String(Math.max(Math.round(parentAvailable-total),0)):'';}const cm=document.getElementById('mCbmMissing');if(cm){const pack=Number(String(document.getElementById('mCbmPacking')?.value??'').replace(',','.'));const real=Number(String(document.getElementById('mCbmChina')?.value??'').replace(',','.'));cm.value=Number.isFinite(pack)&&Number.isFinite(real)?String(Math.max(pack-real,0).toFixed(3).replace(/\.000$/,'')):'';}};
  document.getElementById('mBoxesPacking')?.addEventListener('input',updateMissing);
  document.getElementById('mBoxesChina')?.addEventListener('input',updateMissing);
  document.getElementById('mCbmPacking')?.addEventListener('input',updateMissing);
  document.getElementById('mCbmChina')?.addEventListener('input',updateMissing);
  document.getElementById('mParentLabel')?.addEventListener('change',()=>{const parentId=document.getElementById('mParentLabel')?.value||'';const number=document.getElementById('mNumber');if(parentId&&!existing&&number){number.value=nextSubNumber(parentId);number.readOnly=false;}else if(number){number.readOnly=false;}});
  document.getElementById('mClient')?.addEventListener('change',()=>{const sel=document.getElementById('mParentLabel');if(sel){const current=sel.value;const opts=parentOptions();sel.innerHTML=opts.map(([v,t])=>`<option value="${esc(v)}">${esc(t)}</option>`).join('');if(opts.some(([v])=>String(v)===String(current)))sel.value=current;}if(!existing&&sel?.value){const number=document.getElementById('mNumber');if(number){number.value=nextSubNumber(sel.value);number.readOnly=false;}}});
  document.getElementById('clientDropdownToggle')?.addEventListener('click',()=>{const m=document.getElementById('clientDropdown');if(m)m.classList.toggle('open')});
  document.getElementById('modalCancel').onclick=closeModal;
  updateMissing();
  document.getElementById('modalSave').onclick=async()=>{const parentId=document.getElementById('mParentLabel').value||null;const number=document.getElementById('mNumber').value.trim();const p={number,clientId:document.getElementById('mClient').value,containerId:document.getElementById('mContainer').value||null,status:document.getElementById('mStatus').value,cargoType:document.getElementById('mCargoType').value.trim(),boxesPacking:document.getElementById('mBoxesPacking').value,boxesChina:document.getElementById('mBoxesChina').value,cbmPacking:document.getElementById('mCbmPacking').value,cbmChina:document.getElementById('mCbmChina').value,parentLabelId:parentId,hasSubLabels:document.getElementById('mHasSubLabels')?.checked||false,notes:document.getElementById('mNotes').value.trim()};try{if(!p.number)throw new Error('El número de etiqueta es obligatorio');if(!p.clientId)throw new Error('Selecciona un cliente');if(parentId&&!Number.isFinite(Number(p.boxesPacking)))throw new Error('Indica las cajas que llegaron en esta subetiqueta');if(parentId&&Number(p.boxesPacking)<0)throw new Error('Las cajas de la subetiqueta no pueden ser negativas');if(parentId&&Number(p.cbmChina)<0)throw new Error('El CBM de esta subetiqueta no puede ser negativo');if(existing)await api(`/api/etiquetas/${existing.id}`,{method:'PUT',body:JSON.stringify(p)});else await api('/api/etiquetas',{method:'POST',body:JSON.stringify(p)});await loadRemote();closeModal();renderView();toast(existing?'Etiqueta actualizada':p.parentLabelId?'Subetiqueta creada correctamente':'Etiqueta creada correctamente')}catch(e){toast(e.message)}}
}

function containerModal(existing=null){if(me()?.role!=='admin')return toast('Solo el administrador puede administrar contenedores');const c=existing||{};openModal(existing?'Editar contenedor':'Nuevo contenedor',`<div class="form-grid">${field('mNumber','Número',c.number||'')}${field('mOrigin','Origen',c.origin||'Yiwu')}${field('mDeparture','ATD · Fecha real de salida',String(c.departure||'').slice(0,10),'date')}${field('mEta','ETA · Fecha estimada de llegada',String(c.eta||'').slice(0,10),'date')}${selectField('mStatus','Estado',[['prep','Preparando'],['transit','En tránsito'],['ve','En Venezuela'],['done','Entregado'],['closed','Cerrado']],c.status||'prep')}</div>${field('mNotes','Observaciones',c.notes||'')}`,`<button class="btn btn-secondary" id="modalCancel">Cancelar</button><button class="btn btn-primary" id="modalSave">${existing?'Guardar cambios':'Crear contenedor'}</button>`);document.getElementById('modalCancel').onclick=closeModal;document.getElementById('modalSave').onclick=async()=>{const p={number:document.getElementById('mNumber').value.trim(),origin:document.getElementById('mOrigin').value.trim(),departure:document.getElementById('mDeparture').value,eta:document.getElementById('mEta').value,status:document.getElementById('mStatus').value,notes:document.getElementById('mNotes').value.trim()};try{if(existing)await api(`/api/contenedores/${existing.id}`,{method:'PUT',body:JSON.stringify(p)});else await api('/api/contenedores',{method:'POST',body:JSON.stringify(p)});await loadRemote();closeModal();renderView();toast(existing?'Contenedor actualizado':'Contenedor creado')}catch(e){toast(e.message)}}}

function transferClientRows(sourceId){const clients=db.clients.filter(c=>c.advisorId===sourceId);return clients.length?clients.map(c=>`<label class="check-row"><input type="checkbox" class="transfer-client" value="${c.id}" checked><span><b>${esc(c.code||'—')}</b> · ${esc(c.name)}</span><small>${badgeStatus('client',c.status)}</small></label>`).join(''):'<div class="empty compact">Esta asesora no tiene clientes asignados.</div>'}
function reassignModal(sourceId=''){if(me()?.role!=='admin')return;const advisors=db.users.filter(u=>u.role==='asesora');const source=sourceId||advisors[0]?.id||'';const targets=advisors.filter(u=>u.id!==source&&u.active);openModal('Reasignar cartera',`<div class="modal-intro"><span class="modal-kicker">Administrador</span><h3>Mover clientes entre asesoras</h3><p>Puedes mover toda la cartera o seleccionar clientes concretos. Si eliges varias asesoras destino, los clientes se repartirán automáticamente entre ellas. Sus etiquetas seguirán vinculadas a cada cliente.</p></div><div class="transfer-grid"><div class="transfer-panel"><div class="field"><label>Asesora de origen</label><select id="transferSource">${advisors.map(u=>`<option value="${u.id}" ${u.id===source?'selected':''}>${esc(u.name)}${u.active?'':' · Inactiva'}</option>`).join('')}</select></div><div class="panel-title"><span>Clientes de esta asesora</span><button class="link-btn" id="toggleAllClients">Desmarcar todos</button></div><div id="transferClients" class="checkbox-list">${transferClientRows(source)}</div></div><div class="transfer-panel"><div class="panel-title"><span>Asesoras destino</span><small>Selecciona una o varias</small></div><div class="checkbox-list target-list">${targets.length?targets.map(u=>`<label class="check-row"><input type="checkbox" class="transfer-target" value="${u.id}"><span>${esc(u.name)}</span><small>${u.active?'Activa':'Inactiva'}</small></label>`).join(''):'<div class="empty compact">No hay otras asesoras activas disponibles.</div>'}</div></div></div>`,`<button class="btn btn-secondary" id="modalCancel">Cancelar</button><button class="btn btn-primary" id="modalReassign">Reasignar seleccionados</button>`);document.getElementById('modalCancel').onclick=closeModal;const src=document.getElementById('transferSource');src.onchange=()=>{const newSource=src.value;document.getElementById('transferClients').innerHTML=transferClientRows(newSource);document.querySelectorAll('.transfer-target').forEach(x=>x.checked=false)};document.getElementById('toggleAllClients').onclick=()=>{const boxes=[...document.querySelectorAll('.transfer-client')];const all=boxes.length&&boxes.every(b=>b.checked);boxes.forEach(b=>b.checked=!all);document.getElementById('toggleAllClients').textContent=all?'Seleccionar todos':'Desmarcar todos'};document.getElementById('modalReassign').onclick=async()=>{const sourceAdvisorId=src.value;const clientIds=[...document.querySelectorAll('.transfer-client:checked')].map(x=>x.value);const targetAdvisorIds=[...document.querySelectorAll('.transfer-target:checked')].map(x=>x.value);if(!targetAdvisorIds.length)return toast('Selecciona al menos una asesora destino');if(!clientIds.length)return toast('Selecciona al menos un cliente');try{const r=await api('/api/admin/reassign-clients',{method:'POST',body:JSON.stringify({sourceAdvisorId,targetAdvisorIds,clientIds})});await loadRemote();closeModal();renderView();toast(`${r.moved} cliente(s) reasignado(s) · ${r.labels} etiqueta(s) conservadas`)}catch(e){toast(e.message)}}}

function userModal(existing=null){if(me()?.role!=='admin')return;const u=existing||{};openModal(existing?'Editar usuario':'Nuevo usuario',`<div class="form-grid">${field('mName','Nombre',u.name||'')}${field('mEmail','Correo',u.email||'','email')}${selectField('mRole','Rol',[['asesora','Asesora'],['admin','Administrador']],u.role||'asesora')}<div class="field"><label>Código de asesora${(u.role||'asesora')==='asesora'?'':' (solo asesoras)'}</label><input id="mAdvisorCode" value="${esc(u.advisorCode||'')}" placeholder="Ej. ASE-001" ${(u.role||'asesora')==='asesora'?'':'disabled'}><small class="muted">Identificador único para reconocer a la asesora.</small></div>${selectField('mActive','Estado',[['true','Activo'],['false','Inactivo']],String(u.active!==false))}${field('mPass','Contraseña', '', 'password')}</div>`, `<button class="btn btn-secondary" id="modalCancel">Cancelar</button><button class="btn btn-primary" id="modalSave">${existing?'Guardar cambios':'Crear usuario'}</button>`);document.getElementById('modalCancel').onclick=closeModal;document.getElementById('modalSave').onclick=async()=>{const role=document.getElementById('mRole').value;const payload={name:document.getElementById('mName').value.trim(),email:document.getElementById('mEmail').value.trim(),role,advisorCode:role==='asesora'?document.getElementById('mAdvisorCode').value.trim():'',active:document.getElementById('mActive').value==='true',password:document.getElementById('mPass').value};try{if(existing)await api(`/api/usuarios/${existing.id}`,{method:'PUT',body:JSON.stringify(payload)});else await api('/api/usuarios',{method:'POST',body:JSON.stringify(payload)});await loadRemote();closeModal();renderView();toast(existing?'Usuario actualizado':'Usuario creado')}catch(e){toast(e.message)}}}
function confirmDelete(title,message,onConfirm){openModal(title,`<div class="delete-confirm"><div class="delete-icon">⚠️</div><p>${message}</p><small>Esta acción no se puede deshacer.</small></div>`,`<button class="btn btn-secondary" id="cancelDelete">Cancelar</button><button class="btn btn-danger" id="confirmDelete">Sí, borrar</button>`);document.getElementById('cancelDelete').onclick=closeModal;document.getElementById('confirmDelete').onclick=()=>{closeModal();onConfirm()}}
function deleteClient(id){if(me()?.role!=='admin')return toast('Solo el administrador puede borrar clientes');const c=db.clients.find(x=>sameRefId(x.id,id));if(!c)return;const count=db.labels.filter(l=>sameRefId(l.clientId,id)).length;confirmDelete('Borrar cliente',`¿Seguro que quieres borrar a <b>${esc(c.name)}</b>?${count?` También se borrarán sus <b>${count} etiqueta(s)</b>.`:''}`,async()=>{try{await api(`/api/clientes/${encodeURIComponent(id)}`,{method:'DELETE'});db.labels=db.labels.filter(l=>!sameRefId(l.clientId,id));db.clients=db.clients.filter(x=>!sameRefId(x.id,id));renderView();toast('Cliente eliminado')}catch(e){toast(e.message)}})}
function deleteLabel(id){const l=db.labels.find(x=>sameRefId(x.id,id));if(!l)return;const subCount=!l.parentLabelId?familyChildren(l).length:0;confirmDelete('Borrar etiqueta',`¿Seguro que quieres borrar la etiqueta <b>${esc(l.number)}</b>?${subCount?` También se borrarán sus <b>${subCount} subetiqueta(s)</b>.`:''}`,async()=>{try{await api(`/api/etiquetas/${encodeURIComponent(id)}`,{method:'DELETE'});const removeIds=new Set([String(id)]);if(!l.parentLabelId){familyChildren(l).forEach(x=>removeIds.add(String(x.id)));}db.labels=db.labels.filter(x=>!removeIds.has(String(x.id)));renderView();toast('Etiqueta eliminada')}catch(e){toast(e.message)}})}
function deleteContainer(id){if(me()?.role!=='admin')return toast('Solo el administrador puede borrar contenedores');const c=db.containers.find(x=>sameRefId(x.id,id));if(!c)return;const count=db.labels.filter(l=>sameRefId(l.containerId,id)).length;confirmDelete('Borrar contenedor',`¿Seguro que quieres borrar <b>${esc(c.number)}</b>?${count?` Sus <b>${count} etiqueta(s)</b> quedarán sin contenedor.`:''}`,async()=>{try{await api(`/api/contenedores/${encodeURIComponent(id)}`,{method:'DELETE'});db.containers=db.containers.filter(x=>!sameRefId(x.id,id));db.labels=db.labels.map(l=>sameRefId(l.containerId,id)?{...l,containerId:''}:l);renderView();toast('Contenedor eliminado')}catch(e){toast(e.message)}})}
async function deleteUser(id){
  if(me()?.role!=='admin')return toast('Solo el administrador puede eliminar usuarios');
  const u=db.users.find(x=>x.id===id);
  if(!u)return;
  if(u.id===me()?.id)return toast('No puedes eliminar tu propio usuario');
  const clientCount=db.clients.filter(c=>c.advisorId===id).length;
  const message=clientCount?`¿Seguro que quieres eliminar a <b>${esc(u.name)}</b>? Sus <b>${clientCount} cliente(s)</b> quedarán sin asesora asignada.`:`¿Seguro que quieres eliminar a <b>${esc(u.name)}</b>?`;
  confirmDelete('Eliminar usuario',message,async()=>{
    try{
      await api(`/api/usuarios/${id}`,{method:'DELETE'});
      await loadRemote();
      renderView();
      toast('Usuario eliminado');
    }catch(e){toast(e.message)}
  });
}
function handleAction(action,id){const obj=(prefix,arr)=>arr.find(x=>x.id===id);if(action==='label-ready'){(async()=>{try{await api('/api/etiquetas/'+encodeURIComponent(id)+'/lista',{method:'POST'});await loadRemote();portfolioLabelFilter='';renderView();toast('Compra / etiqueta marcada como lista y archivada.');}catch(e){toast(e.message||'No se pudo archivar la compra / etiqueta');}})();return;}if(action==='client-view'){const c=db.clients.find(x=>sameRefId(x.id,id));if(!c)return;const labels=db.labels.filter(l=>sameRefId(l.clientId,id));openModal(`Cliente: ${esc(c.name)}`,`<div class="detail-grid"><div><b>Código</b><span>${esc(c.code||'—')}</span></div><div><b>Asesora</b><span>${esc(userName(c.advisorId))}</span></div><div><b>Código asesora</b><span>${esc(c.advisorCode||'—')}</span></div><div><b>Estado</b><span>${badgeStatus('client',c.status)}</span></div><div><b>Teléfono</b><span>${esc(c.phone||'—')}</span></div><div><b>Correo</b><span>${esc(c.email||'—')}</span></div><div><b>Empresa</b><span>${esc(c.company||'—')}</span></div><div><b>Estado Venezuela</b><span>${esc(c.state||'—')}</span></div><div><b>Primer contacto</b><span>${fmtDate(c.firstContactDate)}</span></div><div><b>Registro</b><span>${fmtDate(c.createdAt)}</span></div></div><h3>Etiquetas (${labels.length})</h3>${labels.length?`<div class="purchase-list">${labels.map(l=>`<div class="purchase-row"><span class="code-pill">${esc(l.number)}</span><span>${badgeStatus('label',l.status)}</span><span>${esc(l.familyCode||'')}</span><button class="btn btn-secondary btn-sm" data-action="label-view" data-id="${l.id}">Ver detalles</button></div>`).join('')}</div>`:'<div class="empty">Sin etiquetas.</div>'}`,`<button class="btn btn-secondary" id="modalCancel">Cerrar</button>`);document.getElementById('modalCancel').onclick=closeModal;document.querySelectorAll('#modal [data-action=label-view]').forEach(b=>b.onclick=()=>handleAction('label-view',b.dataset.id));return}
if(action==='client-edit'){const c=db.clients.find(x=>x.id===id);if(c)clientModal(c);return}if(action==='client-delete'){deleteClient(id);return}if(action==='label-add-sub'){const parent=db.labels.find(x=>sameRefId(x.id,id));if(!parent)return;closeModal();labelModal(null,parent.clientId,parent.id);return}if(action==='label-view'){const l=db.labels.find(x=>x.id===id);if(!l)return;const fs=familySummary(l),subs=fs?.subs||[],root=fs?.root||l,linkedContainer=l.containerId?db.containers.find(c=>String(c.id)===String(l.containerId)):null;openModal(`Etiqueta: ${esc(l.number)}`,`<div class="detail-grid"><div><b>Estado</b><span>${badgeStatus('label',l.status)}</span></div><div><b>Cliente</b><span>${esc(clientName(l.clientId))}</span></div><div><b>Tipo</b><span>${l.parentLabelId?'Subetiqueta':'Etiqueta principal'}</span></div><div><b>Mercancía</b><span>${esc(l.cargoType||'—')}</span></div><div><b>Cajas de Packing List</b><span>${esc(fs?fs.expected:(l.boxesPacking??'—'))}</span></div><div><b>Cajas de esta Etiqueta</b><span>${esc(l.parentLabelId?(l.boxesPacking??'—'):(l.boxesChina??'—'))}</span></div><div><b>Cajas acumuladas</b><span>${fs?`${fs.registered} / ${fs.expected}`:'—'}</span></div><div><b>Progreso</b><span>${fs?`${fs.progress}%${fs.complete?' · Completa':''}`:'—'}</span></div><div><b>Contenedor</b><span>${esc(containerName(l.containerId))}</span></div><div><b>ATD</b><span>${linkedContainer?fmtDate(linkedContainer.departure):'—'}</span></div><div><b>ETA</b><span>${linkedContainer?fmtDate(linkedContainer.eta):'—'}</span></div><div><b>CBM Packing</b><span>${esc(l.cbmPacking||'—')}</span></div><div><b>CBM China</b><span>${esc(l.cbmChina||'—')}</span></div><div><b>CBM Faltante</b><span>${esc(l.cbmMissing??'—')}</span></div></div>${subs.length?`<h3>Subetiquetas (${subs.length})</h3><div class="purchase-list">${subs.map(x=>`<div class="purchase-row"><span class="code-pill">${esc(x.number)}</span><span>${esc(x.boxesPacking||0)} cajas</span><span>${badgeStatus('label',x.status)}</span><span>${x.containerId?esc(containerName(x.containerId)):'Sin contenedor'}</span></div>`).join('')}</div>`:'<div class="empty compact">No hay subetiquetas.</div>'}`,`<button class="btn btn-secondary" id="modalCancel">Cerrar</button>${!l.parentLabelId?`<button class="btn btn-primary" id="modalAddSub">+ Subetiqueta</button>`:''}`);document.getElementById('modalCancel').onclick=closeModal;document.getElementById('modalAddSub')?.addEventListener('click',()=>{closeModal();labelModal(null,l.clientId,l.id)});return}if(action==='label-edit'){const l=db.labels.find(x=>x.id===id);if(l)labelModal(l);return}if(action==='label-delete'){deleteLabel(id);return}if(action==='container-view'){const c=db.containers.find(x=>x.id===id);if(!c)return;const labels=db.labels.filter(l=>l.containerId===id);const totalCbm=labels.reduce((sum,l)=>sum+(Number(l.cbmChina)||0),0);const admin=me()?.role==='admin';openModal(`Contenedor: ${esc(c.number)}`,`<div class="detail-grid"><div><b>Origen</b><span>${esc(c.origin||'Yiwu')}</span></div><div><b>Estado</b><span>${badgeStatus('container',c.status)}</span></div><div><b>Salida</b><span>${fmtDate(c.departure)}</span></div><div><b>ETA</b><span>${fmtDate(c.eta)}</span></div>${admin?`<div><b>CBM Totales</b><span>${fmtDecimal(totalCbm)}</span></div>`:''}<div><b>Etiquetas</b><span>${labels.length}</span></div></div><h3>Etiquetas asociadas</h3>${labels.length?`<div class="container-label-links">${labels.map(l=>`<button type="button" class="container-label-link" data-label-detail-id="${esc(l.id)}"><span class="code-pill">${esc(l.number||'—')}</span><span class="container-label-name">${esc(clientName(l.clientId))}</span><span class="container-label-arrow">→</span></button>`).join('')}</div>`:'<div class="empty">Sin etiquetas.</div>'}`,`<button class="btn btn-secondary" id="modalCancel">Cerrar</button>`);document.getElementById('modalCancel').onclick=closeModal;document.querySelectorAll('[data-label-detail-id]').forEach(b=>b.addEventListener('click',()=>handleAction('label-view',b.dataset.labelDetailId)));return}if(action==='container-edit'){const c=db.containers.find(x=>x.id===id);if(c)containerModal(c);return}if(action==='container-delete'){deleteContainer(id);return}if(action==='user-edit'){const u=db.users.find(x=>x.id===id);if(u)userModal(u);return}if(action==='user-reassign'){const u=db.users.find(x=>x.id===id);if(u&&u.role==='asesora')reassignModal(u.id);return}if(action==='user-delete'){deleteUser(id);return}if(action==='complaint-view'){const q=(db.complaints||[]).find(x=>x.id===id);if(q)complaintAdminModal(q);return}}
function toast(msg){const t=document.getElementById('toast');if(!t)return;t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2200)}
function downloadCsv(filename,rows){const lines=rows.map(r=>r.map(x=>'"'+String(x??'').replace(/"/g,'""')+'"').join(';'));const blob=new Blob(['\ufeff'+lines.join('\n')],{type:'text/csv;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),500)}
function exportClientsCsv(){const rows=scopedClients();const st={pending:'Pendiente',process:'En proceso',done:'Atendido',inactive:'Inactivo'};downloadCsv('ladin-cloud-clientes.csv',[['Código','Cliente','Asesora','Estado','Estado Venezuela','Teléfono','Correo','Empresa','Fecha','Etiquetas'],...rows.map(c=>[c.code||'',c.name,userName(c.advisorId),st[c.status]||c.status,c.state||'',c.phone,c.email,c.company,c.createdAt,scopedLabels().filter(l=>l.clientId===c.id).length])]);toast('Lista de clientes exportada')}
function exportLabelsCsv(){const rows=scopedLabels(),st={prep:'Preparando',transit:'En tránsito',ve:'En Venezuela',done:'Facturado',facturado:'Facturado',closed:'Cerrado'};downloadCsv('ladin-cloud-etiquetas.csv',[['Etiqueta','Cliente','Grupo de etiquetas','Tipo','Cajas de etiqueta','Cajas acumuladas','Progreso','Contenedor','Estado','Observaciones'],...rows.map(l=>{const fs=familySummary(l);return[l.number,clientName(l.clientId),l.familyCode||'',l.parentLabelId?'Subetiqueta':'Principal',l.boxesPacking??'',fs?`${fs.registered}/${fs.expected}`:'',fs?`${fs.progress}%`:'',containerName(l.containerId),st[l.status]||l.status,l.notes||'']})]);toast('Lista de etiquetas exportada')}
function exportContainersCsv(){const rows=scopedContainers(),st={prep:'Preparando',transit:'En tránsito',ve:'En Venezuela',done:'Entregado',closed:'Cerrado'};downloadCsv('ladin-cloud-contenedores.csv',[['Contenedor','Origen','Salida','ETA','Llegada','Estado','Clientes','Etiquetas','Observaciones'],...rows.map(c=>{const l=db.labels.filter(x=>x.containerId===c.id);return[c.number,c.origin,c.departure,c.eta,c.arrival,st[c.status]||c.status,new Set(l.map(x=>x.clientId)).size,l.length,c.notes||'']})]);toast('Lista de contenedores exportada')}

(async function start(){try{if(session?.token){await loadRemote();}mount()}catch(e){session=null;safeRemove(SESSION);mount();console.error(e)}})();

/* ============================== */
/* LADIN CLOUD v3 - Seguimiento  */
/* Recordatorios + Calendario +  */
/* Importación de Excel          */
/* ============================== */
let calendarCursor = new Date();

function reminderDate(d){return d?new Date(d):null;}
function reminderDueLabel(d){
  const x=reminderDate(d); if(!x) return '—';
  return x.toLocaleString('es-VE',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
}
function dateKeyLocal(d){const x=d instanceof Date?d:new Date(d);return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`}
function monthName(d){return d.toLocaleDateString('es-VE',{month:'long',year:'numeric'}).replace(/^./,m=>m.toUpperCase());}
function sameDay(a,b){return dateKeyLocal(a)===dateKeyLocal(b)}
function remindersScoped(){
  const u=me();
  return (db.reminders||[]).filter(r=>u?.role==='admin'||r.advisorId===u?.id);
}
function calendarEvents(){
  const ev=[];
  scopedContainers().forEach(c=>{
    const labels=db.labels.filter(l=>String(l.containerId)===String(c.id));
    const clients=[...new Set(labels.map(l=>clientName(l.clientId)).filter(Boolean))];
    const labelCount=labels.length;
    if(c.departure) ev.push({key:`co-departure-${c.id}`,date:c.departure,type:'container',title:`Salida ${c.number}`,meta:`${c.origin||'China'} → Venezuela · ${badgeText('container',c.status)} · ${labelCount} etiqueta${labelCount===1?'':'s'}`,icon:'🚢',containerId:c.id});
    if(c.eta) ev.push({key:`co-eta-${c.id}`,date:c.eta,type:'arrival',title:`ETA ${c.number}`,meta:`Llegada estimada · ${c.origin||'China'} → Venezuela · ${labelCount} etiqueta${labelCount===1?'':'s'}`,icon:'📍',containerId:c.id});
    if(c.arrival) ev.push({key:`co-arrival-${c.id}`,date:c.arrival,type:'arrival',title:`Llegó ${c.number}`,meta:`Llegada confirmada · ${labelCount} etiqueta${labelCount===1?'':'s'}`,icon:'✅',containerId:c.id});
  });
  remindersScoped().forEach(r=>{
    const client=clientName(r.clientId);
    const advisor=userName(r.advisorId);
    const bits=[client!=='Sin cliente'?`Cliente: ${client}`:'Sin cliente',advisor!=='—'?`Asesora: ${advisor}`:'',r.notes?`Nota: ${r.notes}`:''].filter(Boolean);
    ev.push({key:`r-${r.id}`,date:r.dueAt,type:r.completed?'done':'reminder',title:r.title,meta:bits.join(' · '),icon:r.completed?'✅':'🔔',id:r.id,reminderId:r.id});
  });
  return ev;
}
function badgeText(type,val){const maps={container:{prep:'Preparando',transit:'En tránsito',ve:'En Venezuela',done:'Entregado',closed:'Cerrado'},label:{prep:'Preparando',transit:'En tránsito',ve:'En Venezuela',done:'Entregado',closed:'Cerrado'}};return maps[type]?.[val]||val||'—'}

function calendarDetailModal(e){
  if(!e)return;
  if(e.reminderId){
    const r=(db.reminders||[]).find(x=>String(x.id)===String(e.reminderId));
    if(!r)return;
    openModal(`${e.icon} ${esc(r.title)}`,`<div class="calendar-detail-card"><div class="calendar-detail-top"><span class="calendar-detail-date">${esc(reminderDueLabel(r.dueAt))}</span>${badgeStatus(r.completed?'label':'label',r.completed?'done':'transit')}</div><div class="detail-grid"><div><b>Cliente</b><span>${esc(clientName(r.clientId))}</span></div><div><b>Asesora</b><span>${esc(userName(r.advisorId))}</span></div><div><b>Estado</b><span>${r.completed?'Completado':'Pendiente'}</span></div><div><b>Notas</b><span>${esc(r.notes||'Sin notas')}</span></div></div></div>`,`<button class="btn btn-secondary" id="modalCancel">Cerrar</button>${r.completed?'':'<button class="btn btn-primary" id="calendarComplete">✓ Completar</button>'}<button class="btn btn-secondary" id="calendarEdit">Editar</button>`);
    document.getElementById('modalCancel').onclick=closeModal;
    document.getElementById('calendarEdit').onclick=()=>{closeModal();reminderModal(r)};
    document.getElementById('calendarComplete')?.addEventListener('click',()=>{closeModal();completeReminder(r.id)});
    return;
  }
  const c=e.containerId?db.containers.find(x=>String(x.id)===String(e.containerId)):null;
  if(!c)return;
  const labels=db.labels.filter(l=>String(l.containerId)===String(c.id));
  const clients=[...new Set(labels.map(l=>clientName(l.clientId)).filter(Boolean))];
  const phase=e.key.includes('departure')?'Salida':e.key.includes('eta')?'ETA':'Llegada';
  openModal(`${e.icon} Contenedor ${esc(c.number)}`,`<div class="calendar-detail-card"><div class="calendar-detail-top"><span class="calendar-detail-date">${esc(phase)} · ${esc(fmtDate(phase==='Salida'?c.departure:phase==='ETA'?c.eta:c.arrival))}</span>${badgeStatus('container',c.status)}</div><div class="detail-grid"><div><b>Origen</b><span>${esc(c.origin||'Yiwu')}</span></div><div><b>Salida</b><span>${fmtDate(c.departure)}</span></div><div><b>ETA</b><span>${fmtDate(c.eta)}</span></div><div><b>Etiquetas</b><span>${labels.length}</span></div><div><b>Clientes</b><span>${clients.length}</span></div></div><div class="calendar-linked-block"><b>Clientes asociados</b><p>${clients.length?esc(clients.join(' · ')):'Sin clientes asociados'}</p><b>Etiquetas asociadas</b><p>${labels.length?labels.map(l=>`<span class="tag">${esc(l.number)} · ${esc(labelEffectiveStatus(l))}</span>`).join(' '):'Sin etiquetas asociadas'}</p><b>Observaciones</b><p>${esc(c.notes||'Sin observaciones')}</p></div></div>`,`<button class="btn btn-secondary" id="modalCancel">Cerrar</button><button class="btn btn-primary" id="calendarContainerEdit">Editar contenedor</button>`);
  document.getElementById('modalCancel').onclick=closeModal;
  document.getElementById('calendarContainerEdit').onclick=()=>{closeModal();containerModal(c)};
}

function teamNotesPanel(){
  const notes=[...(db.teamNotes||[])].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  return `<div class="card section team-notes-card"><div class="row between"><div><span class="calendar-kicker">EQUIPO</span><h3>Notas del equipo</h3><p class="muted-line">Las notas son compartidas entre asesoras y se eliminan automáticamente después de 7 días.</p></div><button class="btn btn-primary" id="newTeamNote">+ Nueva nota</button></div>${notes.length?`<div class="team-notes-list">${notes.map(n=>`<div class="team-note"><div class="team-note-avatar">${esc((userName(n.userId)||'U').split(' ').map(x=>x[0]).slice(0,2).join('').toUpperCase())}</div><div class="team-note-body"><div class="row between"><b>${esc(userName(n.userId))}</b><small>${fmtDT(n.createdAt)}</small></div><p>${esc(n.text)}</p><span>Visible para todo el equipo · se elimina en ${Math.max(0,7-Math.floor((Date.now()-new Date(n.createdAt).getTime())/86400000))} día(s)</span></div></div>`).join('')}</div>`:'<div class="empty">Todavía no hay notas compartidas.</div>'}</div>`;
}
function teamNoteModal(){
  openModal('Nueva nota para el equipo',`<div class="modal-intro"><span class="modal-kicker">Comunicación interna</span><h3>Comparte un aviso</h3><p>Esta nota será visible para las demás asesoras y se eliminará automáticamente después de 7 días.</p></div>${field('teamNoteText','Nota','')}`,`<button class="btn btn-secondary" id="modalCancel">Cancelar</button><button class="btn btn-primary" id="modalSaveTeamNote">Publicar nota</button>`);
  document.getElementById('modalCancel').onclick=closeModal;
  document.getElementById('modalSaveTeamNote').onclick=async()=>{
    const text=document.getElementById('teamNoteText').value.trim();
    if(!text)return toast('Escribe una nota');
    try{await api('/api/team-notes',{method:'POST',body:JSON.stringify({text})});await loadRemote();closeModal();renderView();toast('Nota compartida con el equipo')}catch(e){toast(e.message)}
  };
}

function calendarView(){
  const y=calendarCursor.getFullYear(),m=calendarCursor.getMonth();
  const first=new Date(y,m,1),start=new Date(y,m,1-first.getDay());
  const events=calendarEvents(); const byDay={};
  events.forEach(e=>{const k=dateKeyLocal(e.date);(byDay[k]||(byDay[k]=[])).push(e)});
  const cells=[]; const today=new Date();
  for(let i=0;i<42;i++){
    const d=new Date(start);d.setDate(start.getDate()+i);const k=dateKeyLocal(d);const inMonth=d.getMonth()===m;const dayEvents=(byDay[k]||[]).slice(0,4);
    cells.push(`<div class="cal-cell ${inMonth?'':'muted-month'} ${sameDay(d,today)?'today':''}"><div class="cal-day"><span>${d.getDate()}</span>${dayEvents.length?`<em>${dayEvents.length}</em>`:''}</div><div class="cal-events">${dayEvents.map(e=>`<button class="cal-event ${e.type}" data-cal-reminder="${e.id||''}" data-cal-type="${e.type}" title="${esc(e.title)}"><span>${e.icon}</span>${esc(e.title)}</button>`).join('')}</div></div>`);
  }
  const upcoming=remindersScoped().filter(r=>!r.completed).sort((a,b)=>new Date(a.dueAt)-new Date(b.dueAt)).slice(0,8);
  return `<div class="page-head"><div><h1>Calendario</h1><p>Contenedores, llegadas y recordatorios de contacto en un solo lugar.</p></div><div class="row"><button class="btn btn-secondary" id="prevMonth">‹</button><button class="btn btn-secondary" id="todayMonth">Hoy</button><button class="btn btn-secondary" id="nextMonth">›</button><button class="btn btn-primary" id="newReminder">+ Nuevo recordatorio</button></div></div>
  <div class="calendar-layout">
    <div class="card section calendar-card"><div class="calendar-head"><h3>${monthName(calendarCursor)}</h3><span class="calendar-legend"><span class="legend-dot reminder"></span> Contacto <span class="legend-dot container"></span> Contenedor <span class="legend-dot arrival"></span> Llegada</span></div><div class="cal-weekdays">${['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'].map(x=>`<div>${x}</div>`).join('')}</div><div class="cal-grid">${cells.join('')}</div></div>
    <div class="card section"><div class="row between"><h3>Próximos recordatorios</h3><span class="badge process">${upcoming.length}</span></div>${upcoming.length?`<div class="reminder-list">${upcoming.map(r=>`<div class="reminder-item"><div class="reminder-icon">🔔</div><div class="reminder-body"><b>${esc(r.title)}</b><span>${reminderDueLabel(r.dueAt)}</span><small>${esc(clientName(r.clientId))}${r.notes?' · '+esc(r.notes):''}</small></div><div class="reminder-actions"><button class="btn btn-secondary btn-sm" data-reminder-edit="${r.id}">Editar</button><button class="btn btn-secondary btn-sm" data-reminder-done="${r.id}">✓</button><button class="btn btn-danger btn-sm" data-reminder-delete="${r.id}">Borrar</button></div></div>`).join('')}</div>`:'<div class="empty">No hay recordatorios pendientes.</div>'}</div>
  </div>`;
}
function reminderModal(existing=null){
  const r=existing||{}; const advisors=db.users.filter(u=>u.role==='asesora'&&u.active); const assigned=r.advisorId||me()?.id||'';
  openModal(existing?'Editar recordatorio':'Nuevo recordatorio',`<div class="modal-intro"><span class="modal-kicker">Seguimiento comercial</span><h3>${existing?'Actualiza el seguimiento':'Programa el próximo contacto'}</h3><p>El recordatorio aparecerá en el calendario y en la bandeja de pendientes de la asesora.</p></div><div class="form-grid">${field('rTitle','Título',r.title||'Llamar al cliente')}${selectField('rAdvisor','Asesora',advisors.map(u=>[u.id,u.name]),assigned)}${selectField('rClient','Cliente',[['','Sin cliente'],...scopedClients().map(c=>[c.id,`${c.code||''} · ${c.name}`])],r.clientId||'')}${field('rDue','Fecha y hora',r.dueAt?new Date(r.dueAt).toISOString().slice(0,16):new Date(Date.now()+86400000).toISOString().slice(0,16),'datetime-local')}${field('rNotes','Notas',r.notes||'') }</div>`,`<button class="btn btn-secondary" id="modalCancel">Cancelar</button><button class="btn btn-primary" id="modalSave">${existing?'Guardar cambios':'Crear recordatorio'}</button>`);
  document.getElementById('modalCancel').onclick=closeModal;
  document.getElementById('modalSave').onclick=async()=>{
    const payload={title:document.getElementById('rTitle').value.trim(),advisorId:document.getElementById('rAdvisor').value,clientId:document.getElementById('rClient').value||null,dueAt:document.getElementById('rDue').value,notes:document.getElementById('rNotes').value.trim(),completed:existing?.completed||false};
    if(!payload.title||!payload.dueAt)return toast('Completa el título y la fecha');
    try{if(existing)await api(`/api/reminders/${existing.id}`,{method:'PUT',body:JSON.stringify(payload)});else await api('/api/reminders',{method:'POST',body:JSON.stringify(payload)});await loadRemote();closeModal();currentView='dashboard';renderView();toast(existing?'Recordatorio actualizado':'Recordatorio creado')}catch(e){toast(e.message)}
  };
}
async function completeReminder(id){try{const r=(db.reminders||[]).find(x=>x.id===id);if(!r)return;await api(`/api/reminders/${id}`,{method:'PUT',body:JSON.stringify({...r,completed:true,dueAt:new Date(r.dueAt).toISOString()})});await loadRemote();renderView();toast('Recordatorio completado')}catch(e){toast(e.message)}}
function deleteReminder(id){const r=(db.reminders||[]).find(x=>String(x.id)===String(id));if(!r)return;confirmDelete('Eliminar recordatorio',`¿Seguro que quieres eliminar <b>${esc(r.title)}</b>?`,async()=>{try{await api(`/api/reminders/${id}`,{method:'DELETE'});await loadRemote();renderView();toast('Recordatorio eliminado')}catch(e){toast(e.message)}})}
function importClientsModal(){
  if(me()?.role!=='admin')return toast('Solo el administrador puede importar clientes');
  openModal('Importar clientes desde Excel',`<div class="modal-intro"><span class="modal-kicker">Carga masiva</span><h3>Importa tu base actual</h3><p>El sistema reconoce columnas como Código, Cliente/Nombre, Apellido, Teléfono, Correo, Empresa, Asesora, Estado y Observaciones. Los clientes con el mismo código se actualizan.</p></div><div class="import-drop"><input id="excelFile" type="file" accept=".xlsx,.xls,.csv"><div><b>Selecciona tu Excel</b><span>Máximo 8 MB · primera hoja</span></div></div><div id="importResult" class="import-result"></div>`,`<button class="btn btn-secondary" id="modalCancel">Cancelar</button><button class="btn btn-primary" id="modalImport">Importar clientes</button>`);
  document.getElementById('modalCancel').onclick=closeModal;
  document.getElementById('modalImport').onclick=async()=>{const input=document.getElementById('excelFile');if(!input.files[0])return toast('Selecciona un archivo');const fd=new FormData();fd.append('file',input.files[0]);try{const headers={};if(session?.token)headers.Authorization=`Bearer ${session.token}`;const res=await fetch('/api/admin/import-clients',{method:'POST',headers,body:fd});const text=await res.text();let data={};try{data=JSON.parse(text)}catch{throw new Error(text||'Respuesta no válida')};if(!res.ok)throw new Error(data.error||'No se pudo importar');document.getElementById('importResult').innerHTML=`<div class="import-success"><b>Importación completada</b><span>${data.inserted} nuevos · ${data.updated} actualizados · ${data.skipped} omitidos</span></div>`;await loadRemote();toast('Importación completada')}catch(e){document.getElementById('importResult').innerHTML=`<div class="import-error">${esc(e.message)}</div>`;}}
}
function legacyClientRowsHTML(cs){return cs.map(c=>{const n=scopedLabels().filter(l=>l.clientId===c.id).length;return `<tr><td><span class="code-pill">${esc(c.code||'—')}</span></td><td><b>${esc(c.name)}</b><div class="muted">${esc(c.company||c.phone||'')}</div></td><td>${esc(userName(c.advisorId))}</td><td>${badgeStatus('client',c.status)}</td><td>${esc(c.state||'—')}</td><td>${n}</td><td>${fmtDate(c.createdAt)}</td><td><button class="btn btn-secondary btn-sm" data-action="client-view" data-id="${c.id}">Ver</button> <button class="btn btn-secondary btn-sm" data-action="client-edit" data-id="${c.id}">Editar</button> <button class="btn btn-danger btn-sm" data-action="client-delete" data-id="${c.id}">Borrar</button></td></tr>`}).join('')||'<tr><td colspan="8"><div class="empty">No hay clientes para mostrar.</div></td></tr>';}
function clientsView(){let cs=scopedClients();cs=sortByRecency(cs,clientSortOrder);const q=safeSearchValue('clientPageSearch').trim().toLowerCase();if(q)cs=cs.filter(c=>`${c.code||''} ${c.name||''} ${c.phone||''} ${c.email||''} ${c.company||''}`.toLowerCase().includes(q));if(me()?.role==='admin'&&window.clientPageAdvisorFilter)cs=cs.filter(c=>sameRefId(c.advisorId,window.clientPageAdvisorFilter));const af=me()?.role==='admin'?`<div class="field"><label>Asesora</label><select id="clientAdvisorFilter"><option value="">Todas las asesoras</option>${db.users.filter(u=>u.role==='asesora'&&u.active).map(u=>`<option value="${esc(u.id)}" ${String(window.clientPageAdvisorFilter||'')===String(u.id)?'selected':''}>${esc(u.name)}${u.advisorCode?' · '+esc(u.advisorCode):''}</option>`).join('')}</select></div>`:'';return `<div class="page-head"><div><h1>Clientes</h1><p>Busca rápidamente por nombre, código, teléfono, correo o empresa.</p></div><div class="row"><button class="btn btn-primary" id="newClient">+ Nuevo cliente</button></div></div><div class="card section"><div class="client-tools"><div class="field client-search-field"><label>Buscar cliente</label><div class="page-search-row"><input id="clientPageSearch" value="${esc(safeSearchValue('clientPageSearch'))}" placeholder="Nombre o código de cliente..." autocomplete="off"><button class="btn btn-primary btn-sm page-search-btn" id="clientPageSearchBtn" type="button">Consultar</button></div></div>${af}<div class="sort-control-wrap"><span class="sort-control-label">Orden</span>${sortToggleHTML('client',clientSortOrder)}</div></div><div class="table-wrap"><table class="table"><thead><tr><th>Código</th><th>Cliente</th><th>Asesora</th><th>Estado</th><th>Estado Venezuela</th><th>Etiquetas</th><th>Registro</th><th></th></tr></thead><tbody id="clientsTableBody">${legacyClientRowsHTML(cs)}</tbody></table></div></div>`}

const SALES_QUOTES=[
  {text:'“La gente no compra productos; compra beneficios.”',author:'— Anónimo'},
  {text:'“Vender no es convencer; es ayudar a alguien a tomar una buena decisión.”',author:'— Enfoque comercial'},
  {text:'“Cada contacto es una oportunidad para crear confianza.”',author:'— Enfoque comercial'},
  {text:'“Los vendedores que escuchan mejor, venden mejor.”',author:'— Enfoque comercial'},
  {text:'“El éxito en ventas llega cuando te enfocas en resolver, no solo en cerrar.”',author:'— Enfoque comercial'},
  {text:'“La confianza es la moneda más valiosa de una venta.”',author:'— Enfoque comercial'},
  {text:'“No persigas al cliente: entiende su necesidad y acompáñalo.”',author:'— Enfoque comercial'},
  {text:'“Una conversación bien hecha puede convertirse en una gran oportunidad.”',author:'— Enfoque comercial'}
];
let salesQuoteTimer=null;
function setupSalesQuotes(){
  if(salesQuoteTimer)clearInterval(salesQuoteTimer);
  const text=document.getElementById('salesQuoteText'),author=document.getElementById('salesQuoteAuthor');
  if(!text||!author)return;
  let index=Math.floor(Math.random()*SALES_QUOTES.length);
  const paint=()=>{const q=SALES_QUOTES[index];text.classList.remove('quote-fade');author.classList.remove('quote-fade');void text.offsetWidth;text.textContent=q.text;author.textContent=q.author;text.classList.add('quote-fade');author.classList.add('quote-fade');index=(index+1)%SALES_QUOTES.length};
  paint();
  salesQuoteTimer=setInterval(paint,12000);
}

const CBM_BASE_PRICE=660;
const CBM_TARIFFS={
  light:{label:'Mercancía ligera, inflamable o explosiva',door:[180,150,120,120]},
  imitation:{label:'Mercancía imitación, equipos médicos, maquinaria',door:[150,120,100,100],pickup:[150,120,100,100]},
  hardware:{label:'Ferretería, electrodomésticos, autopartes, accesorios de vehículos, esmalte de uñas, etc.',door:[100,80,60,60]},
  none:{label:'No aplica',door:[0,0,0,0],pickup:[0,0,0,0]}
};
const LAND_TARIFFS={
  'Zulia':130,'Táchira':130,'Falcón':40,'Lara':20,'Trujillo':110,'Mérida':130,'Barinas':110,'Apure':80,'Guárico':80,'Anzoátegui':100,'Delta Amacuro':150,'Amazonas':150,'Bolívar':150,'Miranda':20,'Caracas':20,'Vargas':20,'Aragua':20,'Cojedes':20,'Portuguesa':60,'Yaracuy':20,'Monagas':130,'Sucre':130,'Oriente':130
};
function cbmBracket(cbm){ if(cbm<1)return 0; if(cbm<=5)return 1; if(cbm<=10)return 2; return 3; }
function money(v){return '$'+Number(v||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});}
function cbmCalculatorWidget(){
  const stateOptions=Object.keys(LAND_TARIFFS).map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join('');
  return `<div class="card section cbm-widget">
    <div class="cbm-widget-head"><div><span class="cbm-kicker">HERRAMIENTA RÁPIDA</span><h3>📦 Calculadora de CBM</h3><p class="muted-line">Calcula CBM, extra de despacho y traslado terrestre con las tarifas de referencia.</p></div><span class="cbm-price-chip">$${CBM_BASE_PRICE} / CBM</span></div>
    <div class="cbm-grid cbm-grid-main">
      <div class="field"><label>Largo (cm)</label><input id="cbmLength" type="number" min="0" step="0.01" placeholder="120"></div>
      <div class="field"><label>Ancho (cm)</label><input id="cbmWidth" type="number" min="0" step="0.01" placeholder="80"></div>
      <div class="field"><label>Alto (cm)</label><input id="cbmHeight" type="number" min="0" step="0.01" placeholder="70"></div>
      <div class="field"><label>Cantidad de cajas</label><input id="cbmQty" type="number" min="1" step="1" value="1"></div>
      <div class="field"><label>Tipo de mercancía</label><select id="cbmCargoType"><option value="light">Ligera / inflamable / explosiva</option><option value="imitation" selected>Imitación / médica / maquinaria</option><option value="hardware">Ferretería / electro / autopartes</option><option value="none">No aplica</option></select></div>
       <div class="field"><label>Extra despacho</label><select id="cbmExtraOption"><option value="apply" selected>Aplicar extra</option><option value="none">No aplica</option></select></div>
      <div class="field"><label>Modalidad</label><select id="cbmService"><option value="door" selected>Puerta a puerta</option><option value="pickup">Retiro en Valencia</option></select></div>
      <div class="field"><label>Destino terrestre</label><select id="cbmDestination">${stateOptions}</select></div>
    </div>
    <div class="cbm-result-card cbm-result-wide">
      <div><span class="cbm-result-label">CBM total</span><strong id="cbmTotal">0.00</strong><small>m³</small></div>
      <div><span class="cbm-result-label">Base CBM</span><strong id="cbmBaseCost">$0.00</strong><small>$${CBM_BASE_PRICE} × CBM</small></div>
      <div><span class="cbm-result-label">Extra despacho</span><strong id="cbmExtra">$0.00</strong><small id="cbmExtraLabel">Según volumen / mercancía</small></div>
      <div><span class="cbm-result-label">Terrestre</span><strong id="cbmLand">$0.00</strong><small id="cbmLandLabel">Destino</small></div>
      <div><span class="cbm-result-label">Total estimado</span><strong id="cbmCost">$0.00</strong><small>Base + extra + terrestre</small></div>
    </div>
    <div class="cbm-note">ℹ️ Tarifas referenciales tomadas de los formatos de despacho. Los valores pueden variar según mercancía, modalidad, volumen y destino.</div>
  </div>`;
}
function setupCbmCalculator(){
  const ids=['cbmLength','cbmWidth','cbmHeight','cbmQty','cbmCargoType','cbmExtraOption','cbmService','cbmDestination'];
  if(!ids.every(id=>document.getElementById(id))) return;
  const typeEl=document.getElementById('cbmCargoType'), extraEl=document.getElementById('cbmExtraOption'), serviceEl=document.getElementById('cbmService'), destEl=document.getElementById('cbmDestination');
  const syncCargoOptions=()=>{
    const current=typeEl.value;
    if(serviceEl.value==='pickup'){
      typeEl.innerHTML='<option value="imitation">Imitación / médica / maquinaria</option><option value="none">No aplica</option>';
      typeEl.value=current==='none'?'none':'imitation';
    }else{
      typeEl.innerHTML='<option value="light">Ligera / inflamable / explosiva</option><option value="imitation">Imitación / médica / maquinaria</option><option value="hardware">Ferretería / electro / autopartes</option><option value="none">No aplica</option>';
      typeEl.value=CBM_TARIFFS[current]?current:'imitation';
    }
    if(typeEl.value==='none'){ extraEl.value='none'; extraEl.disabled=true; } else { extraEl.disabled=false; }
    destEl.disabled=serviceEl.value==='pickup';
    if(serviceEl.value==='pickup')destEl.value='Caracas';
  };
  const calc=()=>{
    const l=Number(document.getElementById('cbmLength').value)||0;
    const w=Number(document.getElementById('cbmWidth').value)||0;
    const h=Number(document.getElementById('cbmHeight').value)||0;
    const q=Math.max(1,Number(document.getElementById('cbmQty').value)||1);
    const cbm=(l*w*h*q)/1000000;
    const bracket=cbmBracket(cbm);
    const type=typeEl.value, service=serviceEl.value;
    const tariff=CBM_TARIFFS[type]||CBM_TARIFFS.imitation;
    const extraDisabled=type==='none'||extraEl.value==='none';
    const extra=extraDisabled?0:(service==='pickup'?(tariff.pickup?.[bracket]||0):(tariff.door?.[bracket]||0));
    const land=service==='door'?(LAND_TARIFFS[destEl.value]||0):0;
    const base=cbm*CBM_BASE_PRICE;
    const total=base+extra+land;
    const bracketText=['Menor a 1 m³','De 1 a 5 m³','Mayor a 5 y hasta 10 m³','Mayor a 10 m³'][bracket];
    document.getElementById('cbmTotal').textContent=cbm.toFixed(2);
    document.getElementById('cbmBaseCost').textContent=money(base);
    document.getElementById('cbmExtra').textContent=money(extra);
    document.getElementById('cbmExtraLabel').textContent=extraDisabled?'No aplica':bracketText;
    document.getElementById('cbmLand').textContent=money(land);
    document.getElementById('cbmLandLabel').textContent=service==='door'?`${destEl.value} · tarifa aprox.`:'No aplica en retiro Valencia';
    document.getElementById('cbmCost').textContent=money(total);
  };
  syncCargoOptions();
  ids.forEach(id=>document.getElementById(id).addEventListener('input',calc));
  typeEl.addEventListener('change',()=>{syncCargoOptions();calc();}); extraEl.addEventListener('change',calc); serviceEl.addEventListener('change',()=>{syncCargoOptions();calc();}); destEl.addEventListener('change',calc);
  calc();
}

function dashboardView(){
  const cs=scopedClients(),ls=scopedLabels(),ct=scopedContainers();
  const counts={pending:cs.filter(c=>c.status==='pending').length,process:cs.filter(c=>c.status==='process'||c.status==='done').length,inactive:cs.filter(c=>c.status==='inactive').length};
  const recent=me()?.role==='admin'?[...db.history].sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,10):[];
  const pendingComplaints=(db.complaints||[]).filter(q=>q.status==='pendiente').length;
  const reminders=remindersScoped().filter(r=>!r.completed).sort((a,b)=>new Date(a.dueAt)-new Date(b.dueAt));
  const y=calendarCursor.getFullYear(),m=calendarCursor.getMonth();
  const first=new Date(y,m,1),start=new Date(y,m,1-first.getDay());
  const events=calendarEvents(),byDay={};
  events.forEach(e=>{const k=dateKeyLocal(e.date);(byDay[k]||(byDay[k]=[])).push(e)});
  const today=new Date(),todayKey=dateKeyLocal(today),cells=[];
  for(let i=0;i<42;i++){
    const d=new Date(start);d.setDate(start.getDate()+i);
    const k=dateKeyLocal(d),inMonth=d.getMonth()===m,evs=byDay[k]||[],visible=evs.slice(0,3),more=Math.max(0,evs.length-visible.length);
    cells.push(`<div class="dash-cal-cell ${inMonth?'':'muted-month'} ${k===todayKey?'today':''}"><div class="dash-cal-day"><span>${d.getDate()}</span>${k===todayKey?'<em>HOY</em>':''}</div><div class="dash-cal-events">${visible.map(e=>`<button type="button" class="dash-cal-event ${e.type}" data-cal-reminder="${e.id||''}" data-cal-type="${e.type}" title="${esc(e.title)}"><span class="dash-cal-icon">${e.icon}</span><span>${esc(e.title)}</span></button>`).join('')}${more?`<div class="dash-cal-more">+${more} más</div>`:''}</div></div>`);
  }
  const monthEvents=events.filter(e=>{const d=new Date(e.date);return d.getFullYear()===y&&d.getMonth()===m});
  const monthStats={reminder:monthEvents.filter(e=>e.type==='reminder').length,container:monthEvents.filter(e=>e.type==='container').length,arrival:monthEvents.filter(e=>e.type==='arrival').length};
  return `<div class="page-head"><div><h1>Buenos días, ${esc((me()?.name||'').split(' ')[0])}</h1><p>Resumen operativo de Ladin Cloud.</p></div><div class="row"><button class="btn btn-secondary" id="newComplaintQuick">💬 ${me()?.role==='admin'?'Ver quejas':'Reportar queja'}</button><button class="btn btn-secondary" id="newReminderDash">🔔 Nuevo recordatorio</button><button class="btn btn-primary" id="newClient">+ Nuevo cliente</button></div></div><div class="cards"><div class="card stat"><div class="label">Clientes</div><div class="num">${cs.length}</div></div><div class="card stat"><div class="label">Por atender</div><div class="num">${counts.pending}</div></div><div class="card stat"><div class="label">Atendiendo</div><div class="num">${counts.process}</div></div><div class="card stat"><div class="label">Inactivos</div><div class="num">${counts.inactive}</div></div></div>${dashboardPortfolioWidget()}<div class="dashboard-calendar-card card section"><div class="dashboard-calendar-toolbar"><div><div class="calendar-kicker">OPERACIÓN</div><h3>Calendario operativo</h3><p class="muted-line">Salidas, llegadas y contactos organizados por fecha.</p></div><div class="dashboard-calendar-controls"><button class="cal-nav-btn" id="dashboardCalPrev" aria-label="Mes anterior">‹</button><button class="cal-today-btn" id="dashboardCalToday">Hoy</button><button class="cal-nav-btn" id="dashboardCalNext" aria-label="Mes siguiente">›</button></div></div><div class="dashboard-calendar-meta"><div class="dashboard-month">${monthName(calendarCursor)}</div><div class="dashboard-calendar-legend"><span><i class="legend-dot reminder"></i> Contactos <b>${monthStats.reminder}</b></span><span><i class="legend-dot container"></i> Salidas <b>${monthStats.container}</b></span><span><i class="legend-dot arrival"></i> Llegadas <b>${monthStats.arrival}</b></span></div></div><div class="dash-cal-weekdays">${['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'].map(x=>`<div>${x}</div>`).join('')}</div><div class="dash-cal-grid">${cells.join('')}</div></div><div class="dashboard-bottom-grid"><div class="card section"><div class="row between"><div><h3>🔔 Próximos contactos</h3><p class="muted-line">Recordatorios pendientes de atención.</p></div><span class="badge process">${reminders.length}</span></div>${reminders.length?`<div class="reminder-list compact-list">${reminders.slice(0,5).map(r=>`<div class="reminder-item"><div class="reminder-icon">🔔</div><div class="reminder-body"><b>${esc(r.title)}</b><span>${reminderDueLabel(r.dueAt)}</span><small>${esc(clientName(r.clientId))}${r.notes?' · '+esc(r.notes):''}</small></div><div class="reminder-actions"><button class="btn btn-secondary btn-sm" data-reminder-edit="${r.id}">Editar</button><button class="btn btn-secondary btn-sm" data-reminder-done="${r.id}">✓</button><button class="btn btn-danger btn-sm" data-reminder-delete="${r.id}">Borrar</button></div></div>`).join('')}</div>`:'<div class="empty compact">No tienes recordatorios pendientes.</div>'}</div><div class="card section"><h3>Resumen operativo</h3><div class="cards"><div class="card stat"><div class="label">Etiquetas</div><div class="num">${ls.length}</div></div><div class="card stat"><div class="label">Contenedores</div><div class="num">${ct.length}</div></div><div class="card stat"><div class="label">En tránsito</div><div class="num">${ct.filter(c=>c.status==='transit').length}</div></div><div class="card stat"><div class="label">${me()?.role==='admin'?'Quejas pendientes':'Recordatorios pendientes'}</div><div class="num">${me()?.role==='admin'?pendingComplaints:reminders.length}</div></div></div></div></div>${me()?.role==='admin'?`<div class="card section advisor-stats"><div class="row between"><div><h3>📊 Rendimiento de asesoras</h3><p class="muted-line">Atendiendo = clientes actualmente en atención. Por atender e inactivos se muestran por separado.</p></div><span class="badge process">${db.users.filter(u=>u.role==='asesora'&&u.active).length} asesoras</span></div><div class="table-wrap"><table class="table advisor-stats-table"><thead><tr><th>Asesora</th><th>Atendiendo</th><th>Por atender</th><th>Inactivos</th><th>Asignados</th><th>Etiquetas creadas</th><th>Recordatorios completados</th></tr></thead><tbody>${db.users.filter(u=>u.role==='asesora'&&u.active).map(u=>{const clients=db.clients.filter(c=>c.advisorId===u.id);const assigned=clients.length;const attending=clients.filter(c=>c.status==='process'||c.status==='done').length;const pendingClients=clients.filter(c=>c.status==='pending').length;const inactive=clients.filter(c=>c.status==='inactive').length;const labelsCreated=(db.history||[]).filter(h=>h.userId===u.id&&h.entity==='label'&&/agregad/i.test(h.action||'')).length;const remindersAll=(db.reminders||[]).filter(r=>r.advisorId===u.id);const completed=remindersAll.filter(r=>r.completed).length;const rate=assigned?Math.round((attending/assigned)*100):0;return `<tr><td><b>${esc(u.name)}</b><div class="muted">${esc(u.email)}</div></td><td><b>${attending}</b></td><td>${pendingClients}</td><td>${inactive}</td><td>${assigned}</td><td>${labelsCreated}</td><td>${completed}</td></tr>`}).join('')||'<tr><td colspan="7"><div class="empty">No hay asesoras activas.</div></td></tr>'}</tbody></table></div></div>`:''}${me()?.role==='admin'?`<div class="card section"><div class="row between"><div><h3>Actividad reciente</h3><p class="muted-line">Aquí queda registrado quién hizo cada cambio y qué se modificó.</p></div><button class="btn btn-secondary btn-sm" id="openHistory">Ver historial completo</button></div>${recent.length?`<div class="timeline">${recent.map(h=>`<div class="event"><div class="event-dot"></div><div class="event-content"><b>${esc(h.action||'Cambio')}</b><p>${esc(h.description||h.action||'Sin detalle')}</p><small>${esc(userName(h.userId))} · ${fmtDT(h.createdAt)}</small></div></div>`).join('')}</div>`:'<div class="empty">No hay actividad registrada.</div>'}</div>`:''}`;
}

function shellHTML(){const role=me()?.role;const pending=(db.reminders||[]).filter(r=>!r.completed&&(role==='admin'||r.advisorId===me()?.id)).length;return `<div class="app" style="display:block"><aside class="sidebar"><div class="brand-side"><img class="brand-logo-img side-logo-img" src="ladin-logo.png" alt="Ladin Cloud"></div><nav class="nav"><button data-view="dashboard">🏠 Inicio</button><button data-view="clients">👥 Clientes</button><button data-view="labels">🏷️ Etiquetas</button><button data-view="containers">🚢 Contenedores</button><button data-view="reminders">🔔 Recordatorios ${pending?`<span class="nav-count">${pending}</span>`:''}</button>${role==='admin'?'<button data-view="reports">📊 Reportes</button>':''}<button data-view="complaints">💬 ${role==='admin'?'Quejas del equipo':'Reportar queja'}</button>${role==='admin'?'<button data-view="users">⚙️ Usuarios</button><button data-view="backups">💾 Hacer copia de seguridad</button>':''}</nav><div class="sidebar-bottom"><div class="user-mini"><b>${esc(me()?.name||'Usuario')}</b>${role==='admin'?'Administrador':'Asesora'}</div><button class="btn btn-secondary" id="logoutBtn" style="width:100%">Cerrar sesión</button></div></aside><main class="main"><header class="topbar"><div class="topbar-spacer"></div><button class="notification-btn" id="notificationBtn" title="Recordatorios pendientes">🔔${pending?`<span class="notification-badge">${pending}</span>`:''}</button><div class="topbar-user">${esc(me()?.name||'')}</div></header><section id="page" class="page"></section></main></div><div class="modal-backdrop" id="modal"></div><div class="toast" id="toast"></div>`}
function bindGlobal(){document.querySelectorAll('.nav [data-view]').forEach(b=>b.onclick=()=>{currentView=b.dataset.view;searchTerm='';renderView()});document.getElementById('logoutBtn')?.addEventListener('click',()=>{session=null;safeRemove(SESSION);mount()});document.getElementById('loginBtn')?.addEventListener('click',login);document.getElementById('loginPass')?.addEventListener('keydown',e=>{if(e.key==='Enter')login()});document.getElementById('newComplaintQuick')?.addEventListener('click',()=>me()?.role==='admin'?(currentView='complaints',renderView()):complaintModal());document.getElementById('notificationBtn')?.addEventListener('click',()=>{currentView='reminders';renderView()});document.getElementById('openPortfolio')?.addEventListener('click',()=>{currentView='portfolio';renderView()})}
function bindView(){bindClientPageTools();document.querySelectorAll('#page [data-view]').forEach(b=>b.onclick=()=>{currentView=b.dataset.view;renderView()});document.getElementById('newClient')?.addEventListener('click',()=>clientModal());document.getElementById('newLabel')?.addEventListener('click',()=>labelModal());document.getElementById('newContainer')?.addEventListener('click',()=>containerModal());document.getElementById('newUser')?.addEventListener('click',()=>userModal());document.getElementById('downloadCsvBackup')?.addEventListener('click',downloadCsvBackup);document.getElementById('openReassign')?.addEventListener('click',()=>reassignModal());document.getElementById('newComplaint')?.addEventListener('click',()=>complaintModal());document.getElementById('openHistory')?.addEventListener('click',()=>historyModal());document.getElementById('exportClientsCsv')?.addEventListener('click',exportClientsCsv);document.getElementById('exportLabelsCsv')?.addEventListener('click',exportLabelsCsv);document.getElementById('exportContainersCsv')?.addEventListener('click',exportContainersCsv);document.getElementById('newReminderDash')?.addEventListener('click',()=>reminderModal());document.getElementById('newReminder')?.addEventListener('click',()=>reminderModal());document.getElementById('dashboardCalPrev')?.addEventListener('click',()=>{calendarCursor.setMonth(calendarCursor.getMonth()-1);renderView()});document.getElementById('dashboardCalNext')?.addEventListener('click',()=>{calendarCursor.setMonth(calendarCursor.getMonth()+1);renderView()});document.getElementById('dashboardCalToday')?.addEventListener('click',()=>{calendarCursor=new Date();renderView()});document.querySelectorAll('[data-reminder-edit]').forEach(b=>b.onclick=()=>{const r=(db.reminders||[]).find(x=>String(x.id)===String(b.dataset.reminderEdit));if(r)reminderModal(r)});document.querySelectorAll('[data-reminder-done]').forEach(b=>b.onclick=()=>completeReminder(b.dataset.reminderDone));document.querySelectorAll('[data-reminder-delete]').forEach(b=>b.onclick=()=>deleteReminder(b.dataset.reminderDelete));document.querySelectorAll('[data-cal-reminder]').forEach(b=>b.onclick=()=>{const id=b.dataset.calReminder;if(id){const r=(db.reminders||[]).find(x=>String(x.id)===String(id));if(r)reminderModal(r)}});document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>handleAction(b.dataset.action,b.dataset.id));function portfolioView(){
  const role=me()?.role||'';
  const advisors=db.users.filter(u=>u.role==='asesora'&&u.active).sort((a,b)=>String(a.name||'').localeCompare(String(b.name||'')));
  const selectedAdvisor=role==='admin'?(portfolioAdvisorFilter||''):String(me()?.id||'');
  const remote=portfolioRemote;
  const clients=remote?.clients||[];
  const labels=remote?.labels||[];
  const containers=remote?.containers||[];
  const selectedClient=portfolioClientFilter && clients.some(c=>sameRefId(c.id,portfolioClientFilter))?String(portfolioClientFilter):'';
  const client=clients.find(c=>sameRefId(c.id,selectedClient));
  const clientLabels=client?labels.filter(l=>sameRefId(l.clientId,client.id)):[];
  const activeClientLabels=clientLabels.filter(l=>!l.ready);
  const readyClientLabels=clientLabels.filter(l=>l.ready);
  const labelRank={red:0,yellow:1,green:2};
  const highestPriorityLabel=[...activeClientLabels].sort((a,b)=>(labelRank[labelPriority(a,containers).key]-labelRank[labelPriority(b,containers).key])||String(a.number||'').localeCompare(String(b.number||'')))[0]||null;
  const selectedLabel=portfolioLabelFilter && clientLabels.some(l=>sameRefId(l.id,portfolioLabelFilter))?String(portfolioLabelFilter):'';
  const displayLabel=selectedLabel?clientLabels.find(l=>sameRefId(l.id,selectedLabel)):highestPriorityLabel;
  const clientContainers=client?[...new Set(clientLabels.map(l=>String(l.containerId||'')).filter(Boolean))].map(id=>containers.find(c=>sameRefId(c.id,id))).filter(Boolean):[];
  const missing=client?clientBoxesMissing(client):null;
  const advisorControl=role==='admin' ? (()=>{const urgent=selectedAdvisor?advisorUrgentCount(selectedAdvisor):0;return `<div class="portfolio-select-block"><label>1. Selecciona una asesora</label><select id="portfolioAdvisorFilter" class="inline-select"><option value="">Selecciona una asesora</option>${advisors.map(u=>{const n=advisorUrgentCount(u.id);return `<option value="${esc(u.id)}" ${sameRefId(selectedAdvisor,u.id)?'selected':''}>${n?'⚠️ ':''}${esc(u.name)}${u.advisorCode?' · '+esc(u.advisorCode):''}${n?` · ${n} urgente${n===1?'':'s'}`:''}</option>`}).join('')}</select>${urgent?`<div class="portfolio-advisor-warning">⚠️ Esta asesora tiene <b>${urgent}</b> cliente(s) con atención urgente.</div>`:'<small class="muted">Las asesoras con ⚠️ tienen clientes que requieren atención prioritaria.</small>'}</div>`})() : `<div class="portfolio-select-block"><label>Asesora</label><div class="selected-advisor-chip">👤 ${esc(me()?.name||'')}</div></div>`;
  const clientOptions=clients.map(c=>{
    const cls=labels.filter(l=>sameRefId(l.clientId,c.id));
    const hasLabelError=cls.some(l=>labelBoxesMismatch(l));
    const indicator=hasLabelError||cls.length===0?'⚠️':'✅';
    const statusText=hasLabelError?' · Error en etiqueta':(cls.length===0?' · Sin etiquetas':' · Todo correcto');
    return `<option value="${esc(c.id)}" ${sameRefId(selectedClient,c.id)?'selected':''}>${indicator} ${esc(c.name||'Sin nombre')}${c.code?' · '+esc(c.code):''}${statusText}</option>`;
  }).join('');
  const clientControl=selectedAdvisor?`<div class="portfolio-select-block"><label>${role==='admin'?'2. Selecciona un cliente':'Selecciona un cliente'}</label><select id="portfolioClientFilter" class="inline-select"><option value="">Selecciona un cliente</option>${clientOptions}</select><small class="muted">${clients.length} cliente(s) en esta cartera</small></div>`:'';
  let body='';
  if(!selectedAdvisor) body=`<div class="card section portfolio-prompt"><div class="portfolio-prompt-icon">👤</div><h3>Selecciona una asesora</h3><p>Primero selecciona una asesora para cargar su cartera.</p></div>`;
  else if(portfolioLoading) body=`<div class="card section portfolio-prompt"><div class="portfolio-prompt-icon">⏳</div><h3>Cargando cartera…</h3><p>Estamos consultando la información actualizada de la asesora.</p></div>`;
  else if(remote?.error) body=`<div class="card section portfolio-prompt error"><div class="portfolio-prompt-icon">⚠️</div><h3>No se pudo cargar la cartera</h3><p>${esc(remote.error)}</p><button class="btn btn-secondary" id="portfolioRetry">Reintentar</button></div>`;
  else if(!clients.length) body=`<div class="card section portfolio-prompt"><div class="portfolio-prompt-icon">📋</div><h3>Sin clientes asignados</h3><p>Esta asesora no tiene clientes en su cartera actualmente.</p></div>`;
  else if(!client) body=`<div class="card section portfolio-prompt"><div class="portfolio-prompt-icon">👤</div><h3>Selecciona un cliente</h3><p>Elige uno de los ${clients.length} clientes de la asesora para ver su mercancía y trazabilidad.</p></div>`;
  else {
    body=`<article class="card portfolio-card portfolio-card-single">
      <div class="portfolio-card-head"><div><span class="code-pill">${esc(client.code||'—')}</span><h3>${esc(client.name)}</h3><p>${esc(client.company||'Sin empresa')} · ${esc(userName(client.advisorId)||me()?.name||'')}</p></div>${badgeStatus('client',client.status)}</div>
      <div class="portfolio-main-grid">${(()=>{const base=displayLabel||{};const cargo=base.cargoType||'';const bp=base.boxesPacking!==''&&base.boxesPacking!==undefined?base.boxesPacking:'';const bc=base?(()=>{const fs=familySummary(base);return fs?fs.registered:(base.boxesChina!==''&&base.boxesChina!==undefined?base.boxesChina:'')})():'';const fs=base?familySummary(base):null;const root=fs?.root||base;const cp=root.cbmPacking!==''&&root.cbmPacking!==undefined?root.cbmPacking:'';const cc=fs?fs.cbmRealTotal:(base.cbmChina!==''&&base.cbmChina!==undefined?base.cbmChina:'');const miss=fs?fs.remaining:((bp===''||bp==null)?null:Math.max(Number(bp)-(Number(bc)||0),0));return `<div><span class="portfolio-label">Tipo de mercancía</span><b>${esc(cargo||'No indicado')}</b></div><div><span class="portfolio-label">Compra / envío</span><b>${displayLabel?esc(displayLabel.number||'—'):'Todas las compras'}</b></div><div><span class="portfolio-label">Fecha(s) de llegada</span><b>${displayLabel?(()=>{const co=containers.find(c=>sameRefId(c.id,displayLabel.containerId));return fmtDate(co?.arrival||co?.eta)||'—'})():clientArrivalLabel(client)}</b></div><div><span class="portfolio-label">Cajas Packing List</span><b>${bp===''?'—':esc(bp)}</b></div><div class="${displayLabel&&labelBoxesMismatch(displayLabel,containers)?'portfolio-data-error':''}"><span class="portfolio-label">Cajas en almacén</span><b>${bc===''?'—':esc(bc)}</b></div><div><span class="portfolio-label">Cajas faltantes</span><b class="${miss>0?'warning-text':''}">${miss==null?'—':miss}</b></div><div><span class="portfolio-label">CBM Packing List</span><b>${cp===''?'—':fmtDecimal(cp)}</b></div><div><span class="portfolio-label">CBM real almacén China</span><b>${cc===''?'—':fmtDecimal(cc)}</b></div>${displayLabel&&labelBoxesMismatch(displayLabel,containers)?`<div class="portfolio-box-error">⚠️ <b>Diferencia de cajas:</b> faltan datos por recibir o registrar en esta operación.</div>`:''}`})()}</div>
      ${displayLabel?(()=>{const sl=displayLabel; const slp=labelPriority(sl,containers); const sco=sl?containers.find(c=>sameRefId(c.id,sl.containerId)):null; return sl?`<div class="portfolio-selected-label"><div><span class="portfolio-label">${selectedLabel?'Compra / envío seleccionada':'Compra / envío de mayor prioridad'}</span><h4>${slp.icon} ${esc(sl.number||'Sin número')} · ${esc(slp.label)}</h4></div><div class="portfolio-selected-label-meta">${slp.icon} ${esc(slp.title)}${sco?` · Contenedor: ${esc(sco.number||'—')}`:''}${labelBoxesMismatch(sl,containers)?' · ⚠️ Diferencia de cajas':''}<span>Creada: ${fmtDT(sl.createdAt)}</span><span>Última actualización: ${fmtDT(sl.updatedAt||sl.createdAt)}</span><button class="btn btn-secondary btn-sm" data-action="label-edit" data-id="${esc(sl.id)}">✏️ Editar compra / etiqueta</button></div></div>`:''})():''}
      <div class="portfolio-links">
        <div><span class="portfolio-label">Compras / envíos activas (${activeClientLabels.length})</span>${activeClientLabels.length?`<div class="portfolio-label-list">${activeClientLabels.map((l,idx)=>{const co=containers.find(c=>sameRefId(c.id,l.containerId));const lp=labelPriority(l,containers);return `<div class="portfolio-label-item priority-${lp.key}"><span class="portfolio-priority-emoji" title="${esc(lp.title)}">${lp.icon}</span><div class="portfolio-label-main"><div><b>Compra / envío ${idx+1}</b><span class="muted"> · ${esc(l.number)}</span></div><div class="portfolio-label-meta"><span>${lp.icon} ${esc(lp.label)}</span>${co?`<span>Contenedor: ${esc(co.number||'—')}</span>`:'<span>Sin contenedor</span>'}${badgeStatus('label',co?.status||l.status||'prep')}${labelBoxesMismatch(l,containers)?'<span class="portfolio-error-mini">⚠️ Diferencia de cajas</span>':''}<span>Creada ${fmtDate(l.createdAt)}</span><span>Actualizada ${fmtDate(l.updatedAt||l.createdAt)}</span></div></div><button class="btn btn-secondary btn-sm portfolio-label-edit-btn" data-action="label-edit" data-id="${esc(l.id)}">✏️ Corregir</button></div>`}).join('')}</div>`:'<span class="muted">No hay compras activas.</span>'}${readyClientLabels.length?`<div class="portfolio-archive"><div class="portfolio-label">📁 Archivo de compras / etiquetas listas (${readyClientLabels.length})</div><div class="portfolio-label-list archived">${readyClientLabels.map((l,idx)=>{const co=containers.find(c=>sameRefId(c.id,l.containerId));return `<div class="portfolio-label-item priority-green archived"><span class="priority-dot green">✓</span><div class="portfolio-label-main"><div><b>Compra / envío lista ${idx+1}</b><span class="muted"> · ${esc(l.number)}</span></div><div class="portfolio-label-meta"><span>✓ Lista</span>${co?`<span>Contenedor: ${esc(co.number||'—')}</span>`:'<span>Sin contenedor</span>'}</div></div></div>`}).join('')}</div></div>`:''}</div>
        <div><span class="portfolio-label">Contenedores asociados (${clientContainers.length})</span>${clientContainers.length?clientContainers.map(co=>`<div class="portfolio-container-line"><b>${esc(co.number)}</b> ${badgeStatus('container',co.status)} <span class="muted">Salida: ${fmtDate(co.departure)} · ETA: ${fmtDate(co.eta)} · Llegada: ${fmtDate(co.arrival)}</span></div>`).join(''):'<span class="muted">Sin contenedores asociados.</span>'}</div>
      </div>
      <div class="portfolio-actions"><button class="btn btn-secondary btn-sm" data-action="client-view" data-id="${esc(client.id)}">Ver cliente</button></div>
    </article>`;
  }
  return `<div class="page-head"><div><h1>📦 Cartera y mercancía</h1><p>Consulta la cartera actual de una asesora y revisa la mercancía de cada cliente.</p></div></div><div class="card section portfolio-filter-card"><div class="portfolio-filter-grid">${advisorControl}${clientControl}</div></div>${body}`;
}
}
function remindersView(){
  const reminders=remindersScoped().sort((a,b)=>new Date(a.dueAt)-new Date(b.dueAt));
  const pending=reminders.filter(r=>!r.completed);
  const completed=reminders.filter(r=>r.completed);
  return `<div class="page-head"><div><h1>Recordatorios</h1><p>Gestiona los próximos contactos desde una bandeja clara y rápida.</p></div><button class="btn btn-primary" id="newReminder">+ Nuevo recordatorio</button></div><div class="cards"><div class="card stat"><div class="label">Pendientes</div><div class="num">${pending.length}</div></div><div class="card stat"><div class="label">Completados</div><div class="num">${completed.length}</div></div><div class="card stat"><div class="label">Total</div><div class="num">${reminders.length}</div></div></div><div class="card section"><div class="row between"><div><h3>Próximos contactos</h3><p class="muted-line">Los recordatorios pendientes aparecen primero.</p></div><span class="badge process">${pending.length}</span></div>${pending.length?`<div class="reminder-list">${pending.map(r=>`<div class="reminder-item"><div class="reminder-icon">🔔</div><div class="reminder-body"><b>${esc(r.title)}</b><span>${reminderDueLabel(r.dueAt)}</span><small>${esc(clientName(r.clientId))}${r.notes?' · '+esc(r.notes):''}</small></div><div class="reminder-actions"><button class="btn btn-secondary btn-sm" data-reminder-edit="${r.id}">Editar</button><button class="btn btn-primary btn-sm" data-reminder-done="${r.id}">✓ Completar</button><button class="btn btn-danger btn-sm" data-reminder-delete="${r.id}">Borrar</button></div></div>`).join('')}</div>`:'<div class="empty">No hay recordatorios pendientes.</div>'}</div>${completed.length?`<div class="card section"><div class="row between"><div><h3>Completados</h3><p class="muted-line">Historial reciente de contactos cerrados.</p></div><span class="badge done">${completed.length}</span></div><div class="reminder-list compact-list">${completed.slice(0,10).map(r=>`<div class="reminder-item reminder-completed"><div class="reminder-icon">✅</div><div class="reminder-body"><b>${esc(r.title)}</b><span>${reminderDueLabel(r.dueAt)}</span><small>${esc(clientName(r.clientId))}${r.notes?' · '+esc(r.notes):''}</small></div><div class="reminder-actions"><button class="btn btn-secondary btn-sm" data-reminder-edit="${r.id}">Editar</button></div></div>`).join('')}</div></div>`:''}`;
}
function renderView(){resetExampleSearchArtifacts();document.querySelectorAll('.nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===currentView));const p=document.getElementById('page');if(!p)return;const views={dashboard:dashboardView,clients:clientsView,labels:labelsView,containers:containersView,reminders:remindersView,reports:reportsView,complaints:complaintsView,users:usersView};p.innerHTML=(views[currentView]||dashboardView)();bindView()}


/* ===== V20 MODULES: Estadísticas / Actividad / Calendario ===== */
function advisorStatsData(){
  const advisors=db.users.filter(u=>u.role==='asesora'&&u.active);
  return advisors.map(u=>{
    const clients=db.clients.filter(c=>c.advisorId===u.id);
    const labels=db.labels.filter(l=>clients.some(c=>c.id===l.clientId));
    const reminders=(db.reminders||[]).filter(r=>r.advisorId===u.id);
    const assigned=clients.length;
    const pending=clients.filter(c=>c.status==='pending').length;
    const process=clients.filter(c=>c.status==='process').length;
    const done=clients.filter(c=>c.status==='done').length;
    const contacted=process+done;
    const remDone=reminders.filter(r=>r.completed).length;
    const remPending=reminders.filter(r=>!r.completed).length;
    const rate=assigned?Math.round(contacted/assigned*100):0;
    return {u,assigned,pending,process,done,contacted,labels:labels.length,remDone,remPending,rate};
  });
}
function statsView(){
  if(me()?.role!=='admin') return `<div class="empty">No autorizado.</div>`;
  const rows=advisorStatsData();
  const totalAssigned=rows.reduce((n,x)=>n+x.assigned,0);
  const totalLabels=rows.reduce((n,x)=>n+x.labels,0);
  const maxAssigned=Math.max(1,...rows.map(x=>x.assigned));
  const maxContacted=Math.max(1,...rows.map(x=>x.contacted));
  const maxLabels=Math.max(1,...rows.map(x=>x.labels));
  const recent7=[...db.history].filter(h=>{const d=new Date(h.createdAt),now=new Date();return now-d<=7*86400000}).length;
  return `<div class="page-head"><div><h1>Estadísticas</h1><p>Rendimiento detallado del equipo de asesoras.</p></div><span class="badge process">Solo administración</span></div>
  <div class="cards stats-kpis">
    <div class="card stat"><div class="label">Clientes asignados</div><div class="num">${totalAssigned}</div><span class="kpi-sub">Cartera actual</span></div>
    <div class="card stat"><div class="label">Personas contactadas</div><div class="num">${rows.reduce((n,x)=>n+x.contacted,0)}</div><span class="kpi-sub">En proceso + atendidos</span></div>
    <div class="card stat"><div class="label">Etiquetas</div><div class="num">${totalLabels}</div><span class="kpi-sub">De las carteras</span></div>
    
    
    <div class="card stat"><div class="label">Actividad 7 días</div><div class="num">${recent7}</div><span class="kpi-sub">Acciones registradas</span></div>
  </div>
  <div class="stats-grid-2">
    <div class="card section"><div class="row between"><div><h3>Clientes por asesora</h3><p class="muted-line">Carga de cartera y nivel de contacto.</p></div></div>${rows.map(x=>`<div class="metric-bar-row"><div class="metric-bar-label"><span><b>${esc(x.u.name)}</b></span><strong>${x.assigned}</strong></div><div class="metric-track"><div class="metric-fill assigned" style="width:${Math.round(x.assigned/maxAssigned*100)}%"></div></div><small>${x.contacted} contactados · ${x.pending} pendientes · ${x.done} atendidos</small></div>`).join('')||'<div class="empty">No hay asesoras activas.</div>'}</div>
  </div>
  <div class="stats-grid-2">
    <div class="card section"><h3>Etiquetas creadas</h3><p class="muted-line">Cantidad de etiquetas asociadas a la cartera de cada asesora.</p>${rows.map(x=>`<div class="metric-bar-row"><div class="metric-bar-label"><span><b>${esc(x.u.name)}</b></span><strong>${x.labels}</strong></div><div class="metric-track"><div class="metric-fill labels" style="width:${Math.round(x.labels/maxLabels*100)}%"></div></div></div>`).join('')||'<div class="empty">No hay datos.</div>'}</div>
  </div>
  <div class="card section"><div class="row between"><div><h3>Tabla comparativa</h3><p class="muted-line">Detalle completo del rendimiento individual.</p></div><span class="badge process">${rows.length} asesoras</span></div><div class="table-wrap"><table class="table advisor-detail-table"><thead><tr><th>Asesora</th><th>Asignados</th><th>Contactados</th><th>Pendientes</th><th>Atendidos</th><th>Etiquetas</th><th>Record. completados</th><th>Record. pendientes</th><th>Atención</th></tr></thead><tbody>${rows.map(x=>`<tr><td><b>${esc(x.u.name)}</b><div class="muted">${esc(x.u.email)}</div></td><td>${x.assigned}</td><td>${x.contacted}</td><td>${x.pending}</td><td>${x.done}</td><td>${x.labels}</td><td>${x.remDone}</td><td>${x.remPending}</td><td><span class="advisor-rate ${x.rate>=70?'good':x.rate>=40?'mid':'low'}">${x.rate}%</span></td></tr>`).join('')||'<tr><td colspan="9"><div class="empty">No hay asesoras activas.</div></td></tr>'}</tbody></table></div></div>`;
}
function activityView(){
  const items=[...db.history].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  const todayStart=new Date(); todayStart.setHours(0,0,0,0);
  const today=items.filter(h=>new Date(h.createdAt)>=todayStart).length;
  const week=items.filter(h=>Date.now()-new Date(h.createdAt).getTime()<=7*86400000).length;
  const byUser={}; items.forEach(h=>{const n=userName(h.userId);byUser[n]=(byUser[n]||0)+1});
  const topUsers=Object.entries(byUser).sort((a,b)=>b[1]-a[1]).slice(0,6);
  return `<div class="page-head"><div><h1>Actividad reciente</h1><p>Auditoría visual de las acciones realizadas en el sistema.</p></div><button class="btn btn-secondary" id="openHistory">Ver historial completo</button></div>
  <div class="cards"><div class="card stat"><div class="label">Hoy</div><div class="num">${today}</div><span class="kpi-sub">Acciones</span></div><div class="card stat"><div class="label">Últimos 7 días</div><div class="num">${week}</div><span class="kpi-sub">Actividad</span></div><div class="card stat"><div class="label">Total</div><div class="num">${items.length}</div><span class="kpi-sub">Historial registrado</span></div></div>
  <div class="stats-grid-2"><div class="card section"><h3>Actividad por usuario</h3>${topUsers.map(([name,count])=>`<div class="metric-bar-row"><div class="metric-bar-label"><span><b>${esc(name)}</b></span><strong>${count}</strong></div><div class="metric-track"><div class="metric-fill activity" style="width:${Math.round(count/Math.max(1,topUsers[0]?.[1]||1)*100)}%"></div></div></div>`).join('')||'<div class="empty">No hay actividad.</div>'}</div>
  <div class="card section"><h3>Últimas acciones</h3><div class="activity-mini-list">${items.slice(0,10).map(h=>`<div class="activity-mini"><div class="activity-avatar">${esc((userName(h.userId)||'U').split(' ').map(x=>x[0]).slice(0,2).join('').toUpperCase())}</div><div><b>${esc(h.action||'Cambio')}</b><p>${esc(h.description||h.action||'Sin detalle')}</p><small>${esc(userName(h.userId))} · ${fmtDT(h.createdAt)}</small></div></div>`).join('')||'<div class="empty">No hay actividad registrada.</div>'}</div></div></div>
  <div class="card section"><h3>Línea de tiempo</h3><div class="timeline large-timeline">${items.slice(0,40).map(h=>`<div class="event"><div class="event-dot"></div><div class="event-content"><div class="row between"><b>${esc(h.action||'Cambio')}</b><small>${fmtDT(h.createdAt)}</small></div><p>${esc(h.description||h.action||'Sin detalle')}</p><span>${esc(userName(h.userId))}${h.entity?` · ${esc(h.entity)}`:''}</span></div></div>`).join('')||'<div class="empty">No hay actividad registrada.</div>'}</div></div>`;
}
function calendarView(){
  const y=calendarCursor.getFullYear(),m=calendarCursor.getMonth();
  const first=new Date(y,m,1),start=new Date(y,m,1-first.getDay()),events=calendarEvents(),byDay={};
  events.forEach(e=>{const k=dateKeyLocal(e.date);(byDay[k]||(byDay[k]=[])).push(e)});
  const cells=[],today=new Date();
  for(let i=0;i<42;i++){
    const d=new Date(start);d.setDate(start.getDate()+i);const k=dateKeyLocal(d),evs=(byDay[k]||[]),inMonth=d.getMonth()===m;
    cells.push(`<div class="calendar-cell-pro ${inMonth?'':'muted-month'} ${sameDay(d,today)?'today':''}"><div class="calendar-day-head"><span>${d.getDate()}</span>${sameDay(d,today)?'<em>HOY</em>':''}</div><div class="calendar-events-pro">${evs.slice(0,5).map(e=>`<button type="button" class="calendar-event-pro ${e.type}" data-cal-event="${esc(e.key)}" title="${esc(e.title)}"><span>${e.icon}</span><div><b>${esc(e.title)}</b><small>${esc(e.meta||'Ver detalles')}</small></div></button>`).join('')}${evs.length>5?`<div class="calendar-more">+${evs.length-5} más</div>`:''}</div></div>`)
  }
  const monthEvents=events.filter(e=>{const d=new Date(e.date);return d.getFullYear()===y&&d.getMonth()===m});
  const counts={reminders:monthEvents.filter(e=>e.type==='reminder').length,departures:monthEvents.filter(e=>e.type==='container').length,arrivals:monthEvents.filter(e=>e.type==='arrival').length,done:monthEvents.filter(e=>e.type==='done').length};
  return `<div class="page-head"><div><h1>Calendario</h1><p>Consulta cada asunto con sus detalles y mantén al equipo informado desde un mismo lugar.</p></div><div class="row"><button class="btn btn-secondary" id="prevMonth">‹</button><button class="btn btn-secondary" id="todayMonth">Hoy</button><button class="btn btn-secondary" id="nextMonth">›</button><button class="btn btn-primary" id="newReminder">+ Nuevo recordatorio</button></div></div>
  <div class="calendar-stats cards"><div class="card stat"><div class="label">Contactos</div><div class="num">${counts.reminders}</div></div><div class="card stat"><div class="label">Salidas</div><div class="num">${counts.departures}</div></div><div class="card stat"><div class="label">Llegadas</div><div class="num">${counts.arrivals}</div></div><div class="card stat"><div class="label">Completados</div><div class="num">${counts.done}</div></div></div>
  <div class="calendar-shell-pro card section"><div class="calendar-shell-head"><div><span class="calendar-kicker">OPERACIÓN</span><h2>${monthName(calendarCursor)}</h2><p class="muted-line">Haz clic sobre cualquier asunto para ver cliente, asesora, etiquetas, fechas y observaciones.</p></div><div class="calendar-legend-pro"><span><i class="legend-dot reminder"></i> Contactos</span><span><i class="legend-dot container"></i> Salidas</span><span><i class="legend-dot arrival"></i> Llegadas</span><span><i class="legend-dot done"></i> Completados</span></div></div><div class="calendar-weekdays-pro">${['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'].map(x=>`<div>${x}</div>`).join('')}</div><div class="calendar-grid-pro">${cells.join('')}</div></div>
  ${teamNotesPanel()}`;
}

function dashboardPortfolioWidget(){
  const clients=scopedClients();
  const items=[];
  clients.forEach(c=>{
    const labels=db.labels.filter(l=>String(l.clientId)===String(c.id));
    let pending=0;
    labels.filter(l=>!l.parentLabelId).forEach(root=>{
      const fs=familySummary(root);
      if(fs&&fs.expected>0){
        pending+=Math.max(fs.remaining,0);
      }else if(root.boxesPacking!==''&&root.boxesPacking!=null){
        pending+=Math.max((Number(root.boxesPacking)||0)-(Number(root.boxesChina)||0),0);
      }
    });
    if(pending>0)items.push({client:c,pending});
  });
  items.sort((a,b)=>b.pending-a.pending);
  const total=items.reduce((n,x)=>n+x.pending,0);
  return `<div class="card section dashboard-portfolio-widget" id="dashboardPortfolioWidget"><div class="dashboard-portfolio-widget-head"><div><span class="metric-kicker">SEGUIMIENTO</span><h3>📦 Cartera y mercancía</h3><p class="muted-line">Cajas pendientes de recibir.</p></div><span class="badge process">${total}</span></div>${items.length?`<div class="dashboard-portfolio-list">${items.slice(0,5).map(x=>`<div class="dashboard-portfolio-row"><div><b>${esc(x.client.name)}</b><small>${esc(x.client.code||'Sin código')}</small></div><strong>${x.pending} cajas</strong></div>`).join('')}</div>${items.length>5?`<div class="dashboard-portfolio-more">+${items.length-5} clientes con pendientes</div>`:''}`:`<div class="empty compact">No hay cajas pendientes por recibir.</div>`}<button class="btn btn-secondary btn-sm dashboard-portfolio-btn" id="openPortfolioWidget">Ver cartera completa</button></div>`;
}

function dashboardView(){
  const cs=scopedClients(),ls=scopedLabels(),ct=scopedContainers();
  const counts={pending:cs.filter(c=>c.status==='pending').length,process:cs.filter(c=>c.status==='process'||c.status==='done').length,inactive:cs.filter(c=>c.status==='inactive').length};
  const reminders=remindersScoped().filter(r=>!r.completed).sort((a,b)=>new Date(a.dueAt)-new Date(b.dueAt));
  const pendingComplaints=(db.complaints||[]).filter(q=>q.status==='pendiente').length;
  return `<div class="page-head"><div><h1>Buenos días, ${esc((me()?.name||'').split(' ')[0])}</h1><p>Resumen operativo de Ladin Cloud.</p></div><div class="row"><button class="btn btn-secondary" id="newComplaintQuick">💬 ${me()?.role==='admin'?'Ver quejas':'Reportar queja'}</button><button class="btn btn-secondary" id="newReminderDash">🔔 Nuevo recordatorio</button><button class="btn btn-primary" id="newClient">+ Nuevo cliente</button></div></div>
  <div class="cards"><div class="card stat"><div class="label">Clientes</div><div class="num">${cs.length}</div></div><div class="card stat"><div class="label">Por atender</div><div class="num">${counts.pending}</div></div><div class="card stat"><div class="label">Atendiendo</div><div class="num">${counts.process}</div></div><div class="card stat"><div class="label">Inactivos</div><div class="num">${counts.inactive}</div></div></div>
  <div class="sales-motivation-card card section"><div class="sales-motivation-accent"></div><div class="sales-motivation-copy"><span class="sales-motivation-kicker">MOMENTO DE VENDER</span><blockquote id="salesQuoteText">“La gente no compra productos; compra beneficios.”</blockquote><div class="sales-quote-author" id="salesQuoteAuthor">— Anónimo</div></div><div class="sales-motivation-mark">✦</div></div>${cbmCalculatorWidget()}
  <div class="dashboard-bottom-grid"><div class="card section"><div class="row between"><div><h3>🔔 Próximos contactos</h3><p class="muted-line">Recordatorios pendientes de atención.</p></div><span class="badge process">${reminders.length}</span></div>${reminders.length?`<div class="reminder-list compact-list">${reminders.slice(0,8).map(r=>`<div class="reminder-item"><div class="reminder-icon">🔔</div><div class="reminder-body"><b>${esc(r.title)}</b><span>${reminderDueLabel(r.dueAt)}</span><small>${esc(clientName(r.clientId))}${r.notes?' · '+esc(r.notes):''}</small></div><div class="reminder-actions"><button class="btn btn-secondary btn-sm" data-reminder-edit="${r.id}">Editar</button><button class="btn btn-secondary btn-sm" data-reminder-done="${r.id}">✓</button><button class="btn btn-danger btn-sm" data-reminder-delete="${r.id}">Borrar</button></div></div>`).join('')}</div>`:'<div class="empty compact">No tienes recordatorios pendientes.</div>'}</div><div class="card section"><h3>Resumen operativo</h3><div class="cards dashboard-mini-cards"><div class="card stat"><div class="label">Etiquetas</div><div class="num">${ls.length}</div></div><div class="card stat"><div class="label">Contenedores</div><div class="num">${ct.length}</div></div><div class="card stat"><div class="label">En tránsito</div><div class="num">${ct.filter(c=>c.status==='transit').length}</div></div><div class="card stat"><div class="label">${me()?.role==='admin'?'Quejas pendientes':'Recordatorios pendientes'}</div><div class="num">${me()?.role==='admin'?pendingComplaints:reminders.length}</div></div></div></div></div>`;
}

function codesView(){
  const role=me()?.role;
  return `<div class="page-head"><div><h1>🔑 Códigos de asesores</h1><p>Introduce un código de cliente, contenedor o etiqueta para consultar su estado actual.</p></div><button class="btn btn-secondary" id="refreshCodes">↻ Actualizar</button></div>
  <div class="card section code-lookup-card"><div class="code-lookup-tabs"><button class="code-lookup-tab active" data-code-type="client">👤 Cliente</button><button class="code-lookup-tab" data-code-type="container">🚢 Contenedor</button><button class="code-lookup-tab" data-code-type="label">🏷️ Etiqueta</button></div>
  <div class="code-lookup-form"><div class="field"><label id="codeLookupLabel">Código de cliente</label><input id="codeLookupInput" type="text" placeholder="Ej. LC-CLI-000001" autocomplete="off"></div><button class="btn btn-primary" id="codeLookupBtn">Consultar estado</button></div><div id="codeLookupResult" class="code-lookup-result"><div class="empty">Escribe un código para consultar su estado en tiempo real.</div></div></div>
  <div class="code-status-grid"><div class="card section"><span class="metric-kicker">CLIENTES ASIGNADOS</span><div class="num">${scopedClients().length}</div><p class="muted-line">Clientes disponibles para la asesora.</p></div><div class="card section"><span class="metric-kicker">ETIQUETAS</span><div class="num">${scopedLabels().length}</div><p class="muted-line">Etiquetas vinculadas a sus clientes.</p></div><div class="card section"><span class="metric-kicker">CONTENEDORES</span><div class="num">${scopedContainers().length}</div><p class="muted-line">Contenedores disponibles para seguimiento.</p></div></div>`;
}
function renderCodeLookup(type, raw){
  const code=String(raw||'').trim().toLowerCase();
  const result=document.getElementById('codeLookupResult');
  if(!result)return;
  if(!code){result.innerHTML='<div class="empty">Escribe un código para consultar su estado.</div>';return}

  let item=null,html='';
  if(type==='client') item=scopedClients().find(c=>String(c.code||'').toLowerCase()===code);
  if(type==='label') item=scopedLabels().find(l=>String(l.number||'').toLowerCase()===code);
  if(type==='container') item=scopedContainers().find(c=>String(c.number||'').toLowerCase()===code);
  if(!item){result.innerHTML='<div class="code-not-found"><b>No encontramos ese código.</b><span>Verifica que esté escrito exactamente como aparece en el sistema.</span></div>';return}

  const visibleLabels=()=>scopedLabels();
  const visibleClients=()=>scopedClients();
  const labelStatus=l=>badgeStatus('label',labelEffectiveStatus(l));
  const containerStatus=c=>badgeStatus('container',c?.status);
  const clientStatus=c=>badgeStatus('client',c?.status);
  const labelRows=(labels)=>labels.length?labels.map(l=>{
    const c=db.containers.find(x=>String(x.id)===String(l.containerId));
    return `<tr><td><span class="code-pill">${esc(l.number||'—')}</span></td><td>${esc(clientName(l.clientId))}</td><td>${esc(c?.number||'Sin contenedor')}</td><td>${labelStatus(l)}</td></tr>`;
  }).join(''):'<tr><td colspan="4"><div class="empty compact">Sin etiquetas vinculadas.</div></td></tr>';

  if(type==='client'){
    const labels=visibleLabels().filter(l=>String(l.clientId)===String(item.id));
    const containers=[...new Map(labels.filter(l=>l.containerId).map(l=>{
      const c=db.containers.find(x=>String(x.id)===String(l.containerId));
      return c?[String(c.id),c]:null;
    }).filter(Boolean)).values()];
    const unassigned=labels.filter(l=>!l.containerId);
    html=`
      <div class="code-result-head"><div><span class="code-pill">${esc(item.code||'')}</span><h3>${esc(item.name)}</h3><p>${esc(item.company||item.phone||'')}</p></div>${clientStatus(item)}</div>
      <div class="detail-grid code-detail-grid">
        <div><b>Asesora</b><span>${esc(userName(item.advisorId))}</span></div>
        <div><b>Estado Venezuela</b><span>${esc(item.state||'—')}</span></div>
        <div><b>Teléfono</b><span>${esc(item.phone||'—')}</span></div>
        <div><b>Correo</b><span>${esc(item.email||'—')}</span></div>
        <div><b>Etiquetas</b><span>${labels.length}</span></div>
        <div><b>Contenedores</b><span>${containers.length}</span></div>
        <div><b>Sin contenedor</b><span>${unassigned.length}</span></div>
        <div><b>Actualizado</b><span>${fmtDT(item.updatedAt||item.createdAt)}</span></div>
      </div>
      <div class="code-linked-section"><div class="row between"><h3>🏷️ Etiquetas del cliente</h3><span class="badge process">${labels.length}</span></div>
        <div class="table-wrap"><table class="table compact-table"><thead><tr><th>Etiqueta</th><th>Contenedor</th><th>Estado</th><th>Fechas del contenedor</th></tr></thead><tbody>${labels.length?labels.map(l=>{const c=l.containerId?db.containers.find(x=>String(x.id)===String(l.containerId)):null;return `<tr><td><span class="code-pill">${esc(l.number||'—')}</span></td><td>${esc(c?.number||'Sin contenedor')}</td><td>${labelStatus(l)}</td><td>${c?`Salida ${fmtDate(c.departure)} · ETA ${fmtDate(c.eta)} · Llegada ${fmtDate(c.arrival)}`:'—'}</td></tr>`}).join(''):'<tr><td colspan="4"><div class="empty compact">Este cliente todavía no tiene etiquetas.</div></td></tr>'}</tbody></table></div>
      </div>
      <div class="code-linked-section"><div class="row between"><h3>🚢 Contenedores relacionados</h3><span class="badge process">${containers.length}</span></div>
        ${containers.length?containers.map(c=>{const cls=visibleLabels().filter(l=>String(l.containerId)===String(c.id));const clientIds=[...new Set(cls.map(l=>l.clientId).filter(Boolean))];return `<div class="linked-card"><div class="linked-card-head"><div><span class="code-pill">${esc(c.number)}</span><b>${esc(c.origin||'Yiwu')}</b></div>${containerStatus(c)}</div><div class="linked-card-meta"><span>Salida: ${fmtDate(c.departure)}</span><span>ETA: ${fmtDate(c.eta)}</span><span>Etiquetas: ${cls.length}</span><span>Clientes: ${clientIds.length}</span></div><div class="linked-card-list"><b>Etiquetas en este contenedor</b><div class="tag-list">${cls.length?cls.map(l=>`<span class="tag">${esc(l.number)} · ${esc(clientName(l.clientId))}</span>`).join(''):'<span class="muted">Sin etiquetas.</span>'}</div></div></div>`}).join(''):'<div class="empty compact">Las etiquetas de este cliente todavía no están asociadas a ningún contenedor.</div>'}
      </div>`;
  }

  if(type==='container'){
    const labels=visibleLabels().filter(l=>String(l.containerId)===String(item.id));
    const clients=[...new Map(labels.map(l=>{const c=visibleClients().find(x=>String(x.id)===String(l.clientId));return c?[String(c.id),c]:null;}).filter(Boolean)).values()];
    html=`
      <div class="code-result-head"><div><span class="code-pill">${esc(item.number||'')}</span><h3>Contenedor ${esc(item.number||'')}</h3><p>${esc(item.origin||'Yiwu')}</p></div>${containerStatus(item)}</div>
      <div class="detail-grid code-detail-grid">
        <div><b>Salida</b><span>${fmtDate(item.departure)}</span></div><div><b>ETA</b><span>${fmtDate(item.eta)}</span></div>
        <div><b>Etiquetas</b><span>${labels.length}</span></div><div><b>Clientes</b><span>${clients.length}</span></div><div><b>Actualizado</b><span>${fmtDT(item.updatedAt||item.createdAt)}</span></div>
      </div>
      <div class="code-linked-section"><div class="row between"><h3>🏷️ Etiquetas dentro del contenedor</h3><span class="badge process">${labels.length}</span></div>
        <div class="table-wrap"><table class="table compact-table"><thead><tr><th>Etiqueta</th><th>Cliente</th><th>Estado</th></tr></thead><tbody>${labelRows(labels)}</tbody></table></div>
      </div>
      <div class="code-linked-section"><div class="row between"><h3>👥 Clientes relacionados</h3><span class="badge process">${clients.length}</span></div>
        ${clients.length?clients.map(c=>{const cls=labels.filter(l=>String(l.clientId)===String(c.id));return `<div class="linked-card"><div class="linked-card-head"><div><span class="code-pill">${esc(c.code||'')}</span><b>${esc(c.name)}</b></div>${clientStatus(c)}</div><div class="linked-card-meta"><span>Asesora: ${esc(userName(c.advisorId))}</span><span>Etiquetas en este contenedor: ${cls.length}</span><span>Teléfono: ${esc(c.phone||'—')}</span></div><div class="linked-card-list"><b>Etiquetas de este cliente dentro del contenedor</b><div class="tag-list">${cls.length?cls.map(l=>`<span class="tag">${esc(l.number)} · ${labelStatus(l).replace(/<[^>]+>/g,'')}</span>`).join(''):'<span class="muted">Sin etiquetas.</span>'}</div></div></div>`}).join(''):'<div class="empty compact">No hay clientes con etiquetas asociadas a este contenedor.</div>'}
      </div>`;
  }

  if(type==='label'){
    const linkedClient=visibleClients().find(c=>String(c.id)===String(item.clientId));
    const container=item.containerId?db.containers.find(c=>String(c.id)===String(item.containerId)):null;
    const clientLabels=linkedClient?visibleLabels().filter(l=>String(l.clientId)===String(linkedClient.id)):[];
    const containerLabels=container?visibleLabels().filter(l=>String(l.containerId)===String(container.id)):[];
    html=`
      <div class="code-result-head"><div><span class="code-pill">${esc(item.number||'')}</span><h3>Etiqueta ${esc(item.number||'')}</h3><p>Cliente: ${esc(linkedClient?.name||'Sin cliente')}</p></div>${labelStatus(item)}</div>
      <div class="detail-grid code-detail-grid">
        <div><b>Cliente</b><span>${esc(linkedClient?.name||'Sin cliente')}</span></div>
        <div><b>Código cliente</b><span>${esc(linkedClient?.code||'—')}</span></div>
        <div><b>Asesora</b><span>${esc(userName(linkedClient?.advisorId))}</span></div>
        <div><b>Contenedor</b><span>${esc(container?.number||'Sin contenedor')}</span></div>
        <div><b>Estado</b><span>${labelStatus(item)}${container?'<small class="muted">Heredado del contenedor</small>':''}</span></div>
        <div><b>Última actualización</b><span>${fmtDT(item.updatedAt||item.createdAt)}</span></div>
      </div>
      <div class="code-linked-section"><div class="row between"><h3>👤 Todas las etiquetas de este cliente</h3><span class="badge process">${clientLabels.length}</span></div>
        <div class="table-wrap"><table class="table compact-table"><thead><tr><th>Etiqueta</th><th>Contenedor</th><th>Estado</th></tr></thead><tbody>${labelRows(clientLabels)}</tbody></table></div>
      </div>
      <div class="code-linked-section"><div class="row between"><h3>🚢 ${container?'Etiquetas del contenedor':'Contenedor asociado'}</h3><span class="badge process">${container?containerLabels.length:0}</span></div>
        ${container?`<div class="linked-card"><div class="linked-card-head"><div><span class="code-pill">${esc(container.number)}</span><b>${esc(container.origin||'Yiwu')}</b></div>${containerStatus(container)}</div><div class="linked-card-meta"><span>Salida: ${fmtDate(container.departure)}</span><span>ETA: ${fmtDate(container.eta)}</span><span>Llegada: ${fmtDate(container.arrival)}</span><span>Etiquetas: ${containerLabels.length}</span></div><div class="linked-card-list"><b>Otras etiquetas en este contenedor</b><div class="tag-list">${containerLabels.filter(l=>String(l.id)!==String(item.id)).map(l=>`<span class="tag">${esc(l.number)} · ${esc(clientName(l.clientId))}</span>`).join('')||'<span class="muted">Esta es la única etiqueta del contenedor.</span>'}</div></div></div>`:'<div class="empty compact">Esta etiqueta todavía no está asociada a un contenedor.</div>'}
      </div>`;
  }

  result.innerHTML=`<div class="code-result">${html}</div>`;
}

function shellHTML(){
  const role=me()?.role;
  const pending=(db.reminders||[]).filter(r=>!r.completed&&(role==='admin'||r.advisorId===me()?.id)).length;
  const collapsed=localStorage.getItem('ladin_sidebar_collapsed')==='1';
  const navBtn=(view,icon,label,extra='')=>`<button data-view="${view}" title="${label}"><span class="nav-icon">${icon}</span><span class="nav-label">${label}</span>${extra}</button>`;
  return `<div class="app ${collapsed?'sidebar-collapsed':''}" style="display:block"><aside class="sidebar"><div class="brand-side"><img class="brand-logo-img side-logo-img" src="ladin-logo.png" alt="Ladin Cloud"><button class="sidebar-toggle" id="sidebarToggle" title="Mostrar/ocultar menú" aria-label="Mostrar u ocultar menú">${collapsed?'☰':'‹'}</button></div><nav class="nav">${navBtn('dashboard','🏠','Inicio')}${navBtn('clients','👥','Clientes')}${navBtn('labels','🏷️','Etiquetas')}${navBtn('containers','🚢','Contenedores')}${navBtn('reminders','🔔','Recordatorios',pending?`<span class="nav-count nav-badge">${pending}</span>`:'')}<div class="nav-divider"><span class="nav-label">SEGUIMIENTO</span></div>${navBtn('codes','🔑','Códigos')}${navBtn('portfolio','📦','Cartera y mercancía')}<div class="nav-divider"><span class="nav-label">ANÁLISIS</span></div>${role==='admin'?navBtn('stats','📊','Estadísticas'):''}${role==='admin'?navBtn('activity','🕘','Actividad reciente'):''}${navBtn('calendar','🗓️','Calendario')}<div class="nav-divider"><span class="nav-label">RECURSOS</span></div>${navBtn('downloads','📁','Descargas')}<div class="nav-divider"><span class="nav-label">GESTIÓN</span></div>${role==='admin'?navBtn('reports','📑','Reportes'):''}${navBtn('complaints','💬',role==='admin'?'Quejas del equipo':'Reportar queja')}${role==='admin'?navBtn('users','⚙️','Usuarios'):''}${role==='admin'?navBtn('backups','💾','Hacer copia de seguridad'):''}</nav><div class="sidebar-bottom"><div class="user-mini"><b>${esc(me()?.name||'Usuario')}</b><span class="nav-label">${role==='admin'?'Administrador':'Asesora'}</span></div><button class="btn btn-secondary logout-btn" id="logoutBtn" style="width:100%"><span class="nav-icon">↪</span><span class="nav-label">Cerrar sesión</span></button></div></aside><main class="main"><header class="topbar"><div class="topbar-spacer"></div><button class="notification-btn" id="notificationBtn" title="Recordatorios pendientes">🔔${pending?`<span class="notification-badge">${pending}</span>`:''}</button><div class="topbar-user">${esc(me()?.name||'')}</div></header><section id="page" class="page"></section></main></div><div class="modal-backdrop" id="modal"></div><div class="toast" id="toast"></div>`}
function bindGlobal(){document.querySelectorAll('.nav [data-view]').forEach(b=>b.onclick=()=>{currentView=b.dataset.view;renderView()});document.getElementById('sidebarToggle')?.addEventListener('click',()=>{const app=document.querySelector('.app');if(!app)return;app.classList.toggle('sidebar-collapsed');localStorage.setItem('ladin_sidebar_collapsed',app.classList.contains('sidebar-collapsed')?'1':'0');const btn=document.getElementById('sidebarToggle');if(btn)btn.textContent=app.classList.contains('sidebar-collapsed')?'☰':'‹'});document.getElementById('logoutBtn')?.addEventListener('click',()=>{session=null;safeRemove(SESSION);mount()});document.getElementById('loginBtn')?.addEventListener('click',login);document.getElementById('loginPass')?.addEventListener('keydown',e=>{if(e.key==='Enter')login()});document.getElementById('newComplaintQuick')?.addEventListener('click',()=>me()?.role==='admin'?(currentView='complaints',renderView()):complaintModal());document.getElementById('notificationBtn')?.addEventListener('click',()=>{currentView='reminders';renderView()});document.getElementById('openPortfolio')?.addEventListener('click',()=>{currentView='portfolio';renderView()})}
function bindLabelsPageTools(){const i=document.getElementById('labelPageSearch');if(i)i.addEventListener('input',()=>{const value=String(i.value||'');labelPageSearchValue=value;updateLabelRows(value)});}

function bindView(){bindClientPageTools();bindLabelsPageTools();bindSortControls();document.querySelectorAll('#page [data-view]').forEach(b=>b.onclick=()=>{currentView=b.dataset.view;renderView()});document.getElementById('downloadCsvBackup')?.addEventListener('click',downloadCsvBackup);document.getElementById('newClient')?.addEventListener('click',()=>clientModal());document.getElementById('newLabel')?.addEventListener('click',()=>labelModal());document.getElementById('newContainer')?.addEventListener('click',()=>containerModal());document.getElementById('newUser')?.addEventListener('click',()=>userModal());document.getElementById('openReassign')?.addEventListener('click',()=>reassignModal());document.getElementById('newComplaint')?.addEventListener('click',()=>complaintModal());document.getElementById('openHistory')?.addEventListener('click',()=>historyModal());document.getElementById('exportClientsCsv')?.addEventListener('click',exportClientsCsv);document.getElementById('exportLabelsCsv')?.addEventListener('click',exportLabelsCsv);document.getElementById('exportContainersCsv')?.addEventListener('click',exportContainersCsv);document.getElementById('newReminderDash')?.addEventListener('click',()=>reminderModal());document.getElementById('newReminder')?.addEventListener('click',()=>reminderModal());document.getElementById('prevMonth')?.addEventListener('click',()=>{calendarCursor.setMonth(calendarCursor.getMonth()-1);renderView()});document.getElementById('nextMonth')?.addEventListener('click',()=>{calendarCursor.setMonth(calendarCursor.getMonth()+1);renderView()});document.getElementById('todayMonth')?.addEventListener('click',()=>{calendarCursor=new Date();renderView()});document.querySelectorAll('[data-reminder-edit]').forEach(b=>b.onclick=()=>{const r=(db.reminders||[]).find(x=>String(x.id)===String(b.dataset.reminderEdit));if(r)reminderModal(r)});document.querySelectorAll('[data-reminder-done]').forEach(b=>b.onclick=()=>completeReminder(b.dataset.reminderDone));document.querySelectorAll('[data-reminder-delete]').forEach(b=>b.onclick=()=>deleteReminder(b.dataset.reminderDelete));document.querySelectorAll('[data-cal-reminder]').forEach(b=>b.onclick=()=>{const id=b.dataset.calReminder;if(id){const r=(db.reminders||[]).find(x=>String(x.id)===String(id));if(r)reminderModal(r)}});document.querySelectorAll('[data-cal-event]').forEach(b=>b.onclick=()=>{const key=b.dataset.calEvent;const e=calendarEvents().find(x=>x.key===key);if(e)calendarDetailModal(e)});document.getElementById('newTeamNote')?.addEventListener('click',teamNoteModal);document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>handleAction(b.dataset.action,b.dataset.id));document.querySelectorAll('[data-complaint-pdf]').forEach(b=>b.onclick=()=>downloadComplaintPdf(b.dataset.complaintPdf));document.querySelectorAll('[data-complaint-file]').forEach(b=>b.onclick=()=>downloadComplaintFile(b.dataset.complaintFile,b.dataset.fileId,b.dataset.fileName));document.querySelectorAll('[data-old-client-open]').forEach(b=>b.onclick=()=>{const c=db.clients.find(x=>String(x.id)===String(b.dataset.oldClientOpen));if(!c)return;clientPageSearchValue=String(c.code||c.name||'');currentView='clients';renderView()});document.querySelectorAll('[data-old-client-reminder]').forEach(b=>b.onclick=()=>{const c=db.clients.find(x=>String(x.id)===String(b.dataset.oldClientReminder));if(c)reminderModal({title:`Reactivar cliente: ${c.name}`,advisorId:c.advisorId,clientId:c.id,dueAt:new Date(Date.now()+86400000).toISOString(),notes:'Cliente cerrado/inactivo con más de 30 días sin nueva orden. Escribir para reactivar la relación comercial.',completed:false});})
  const codeInput=document.getElementById('codeLookupInput');
  let codeType='client';
  const codeLabel=document.getElementById('codeLookupLabel');
  const codeBtn=document.getElementById('codeLookupBtn');
  document.querySelectorAll('.code-lookup-tab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.code-lookup-tab').forEach(x=>x.classList.remove('active'));b.classList.add('active');codeType=b.dataset.codeType;if(codeLabel)codeLabel.textContent=codeType==='client'?'Código de cliente':codeType==='container'?'Código de contenedor':'Código de etiqueta';if(codeInput){codeInput.value='';codeInput.placeholder=codeType==='client'?'Ej. LC-CLI-000001':codeType==='container'?'Ej. CTN-0001':'Ej. ETQ-000001'}document.getElementById('codeLookupResult')?.replaceChildren(Object.assign(document.createElement('div'),{className:'empty',textContent:'Escribe un código para consultar su estado en tiempo real.'}))});
  codeBtn?.addEventListener('click',()=>renderCodeLookup(codeType,codeInput?.value));
  codeInput?.addEventListener('keydown',e=>{if(e.key==='Enter')renderCodeLookup(codeType,codeInput.value)});
  document.getElementById('refreshCodes')?.addEventListener('click',async()=>{await loadRemote();renderView();toast('Información actualizada')});
  document.getElementById('openPortfolio')?.addEventListener('click',()=>{currentView='portfolio';portfolioAdvisorFilter=me()?.role==='admin'?'':String(me()?.id||'');portfolioClientFilter='';portfolioLabelFilter='';portfolioRemote=null;renderView();if(me()?.role!=='admin'&&me()?.id)loadPortfolioData(me().id)});document.getElementById('openPortfolioWidget')?.addEventListener('click',()=>{currentView='portfolio';portfolioAdvisorFilter=me()?.role==='admin'?'':String(me()?.id||'');portfolioClientFilter='';portfolioLabelFilter='';portfolioRemote=null;renderView();if(me()?.role!=='admin'&&me()?.id)loadPortfolioData(me().id)});
  document.getElementById('portfolioAdvisorFilter')?.addEventListener('change',e=>{portfolioAdvisorFilter=String(e.target.value||'');portfolioClientFilter='';portfolioLabelFilter='';portfolioRemote=null;renderView();if(portfolioAdvisorFilter)loadPortfolioData(portfolioAdvisorFilter)});
  document.getElementById('portfolioClientFilter')?.addEventListener('change',e=>{portfolioClientFilter=String(e.target.value||'');portfolioLabelFilter='';renderView()});
  document.getElementById('portfolioLabelFilter')?.addEventListener('change',e=>{portfolioLabelFilter=String(e.target.value||'');renderView()});
  document.getElementById('portfolioRetry')?.addEventListener('click',()=>{const id=me()?.role==='admin'?portfolioAdvisorFilter:me()?.id;if(id)loadPortfolioData(id)});document.getElementById('portfolioRefresh')?.addEventListener('click',()=>{const id=me()?.role==='admin'?portfolioAdvisorFilter:me()?.id;if(id)loadPortfolioData(id);});
  if(currentView==='portfolio' && me()?.role!=='admin' && me()?.id && !portfolioRemote && !portfolioLoading) loadPortfolioData(me().id);
  if(currentView==='dashboard'){setupSalesQuotes();setupCbmCalculator();} else if(salesQuoteTimer){clearInterval(salesQuoteTimer);salesQuoteTimer=null;}
}

const DOWNLOAD_FORMATS = [{"name": "Formato factura", "file": "Formato_Factura.xlsx", "ext": "XLSX", "size": 24388}, {"name": "Formato de canalizacion", "file": "Formato_Canalizacion.xlsx", "ext": "XLSX", "size": 87218}, {"name": "FACTURA DE SERVICIOS SHUNFENG 2w947s", "file": "Factura_Servicios_SHUNFENG.xlsx", "ext": "XLSX", "size": 166260}, {"name": "ACUERDO DE COMPRAS", "file": "Acuerdo_de_Compras.docx", "ext": "DOCX", "size": 22839}, {"name": "Acuerdo de agencia de exportacion de mercancias shunfeng (contrato principal)", "file": "Acuerdo_Agencia_Exportacion_SHUNFENG.pdf", "ext": "PDF", "size": 52949}, {"name": "Formato solicitud de financiamiento", "file": "Solicitud_de_Financiamiento.docx", "ext": "DOCX", "size": 30331}, {"name": "contrato acuerdo de pago anticipado para cargas consolidadas", "file": "Acuerdo_de_Pago_Anticipado_Cargas_Consolidadas.pdf", "ext": "PDF", "size": 91837}, {"name": "formato de consolidacion de tarifa", "file": "Formato_Consolidacion_de_Tarifa.xlsx", "ext": "XLSX", "size": 46278}, {"name": "Formato cotizacion", "file": "Formato_Cotizacion.xlsx", "ext": "XLSX", "size": 6521963}, {"name": "formato presupuesto nuevo", "file": "Formato_Presupuesto.xlsx", "ext": "XLSX", "size": 1099895}];
function downloadsView(){
  const role=me()?.role;
  const icon=(ext)=>ext==='PDF'?'📄':ext==='DOCX'?'📝':'📊';
  const size=(bytes)=>bytes>=1024*1024?(bytes/(1024*1024)).toFixed(1)+' MB':Math.max(1,Math.round(bytes/1024))+' KB';
  return `<div class="page-head"><div><h1>Sección de descargas</h1><p>Encuentra y descarga rápidamente los formatos que necesitas para tu gestión diaria.</p></div></div>
    <div class="downloads-hero card"><div class="downloads-hero-icon">↓</div><div><span class="downloads-kicker">RECURSOS LADIN CLOUD</span><h2>Formatos disponibles</h2><p>Los archivos se mantienen en su formato original para que puedas editarlos cuando sea necesario.</p></div></div>
    <div class="downloads-grid">${DOWNLOAD_FORMATS.map(f=>`<div class="card download-card"><div class="download-icon">${icon(f.ext)}</div><div class="download-copy"><span class="download-type">${f.ext}</span><h3>${esc(f.name)}</h3><p>${size(f.size)} · Formato oficial</p></div><a class="btn btn-primary download-btn" href="/descargas/${encodeURIComponent(f.file)}" download>Descargar</a></div>`).join('')}</div>`;
}


function clientLinkedContainers(c){
  const ls=db.labels.filter(l=>String(l.clientId)===String(c.id));
  return db.containers.filter(co=>ls.some(l=>String(l.containerId)===String(co.id)));
}
function clientBoxesMissing(c){
  if(c.boxesPacking===null || c.boxesPacking===undefined || c.boxesPacking==='') return null;
  const expected=Number(c.boxesPacking); if(!Number.isFinite(expected)) return null;
  const china=Number(c.boxesChina)||0;
  return Math.max(expected-china,0);
}
function clientArrivalLabel(c){
  const arr=clientLinkedContainers(c).map(x=>x.arrival||x.eta).filter(Boolean).sort();
  return arr.length?arr.map(fmtDate).join(' · '):'—';
}
function labelHasError(label, containers=[]){
  if(!label)return true;
  const isFamily=!!(label.parentLabelId||label.isFamilyParent||label.subLabelCount>0||label.familyCode);
  const has=v=>v!==undefined&&v!==null&&String(v).trim()!=='';
  const num=v=>has(v)&&Number.isFinite(Number(v));
  const packing=Number(label.boxesPacking), china=Number(label.boxesChina), cbmPacking=Number(label.cbmPacking), cbmChina=Number(label.cbmChina);
  if([packing,china,cbmPacking,cbmChina].some(v=>Number.isNaN(v)||v<0))return true;
  if(isFamily){
    const fs=familySummary(label);
    return !!(fs&&fs.over);
  }
  const co=label?.containerId?containers.find(c=>sameRefId(c.id,label.containerId)):null;
  const status=String(co?.status||label?.status||'prep').toLowerCase();
  const arrived=['ve','done','closed'].includes(status);
  const missingAtArrival=arrived && (!has(label.cargoType)||!has(label.boxesPacking)||!has(label.cbmPacking)||!has(label.cbmChina)||!co);
  return missingAtArrival;
}
function labelBoxesMismatch(label, containers=[]){
  if(!label)return false;
  const fs=familySummary(label);
  if(fs)return !!fs.over;
  const co=label?.containerId?containers.find(c=>sameRefId(c.id,label.containerId)):null;
  const status=String(co?.status||label?.status||'prep').toLowerCase();
  const packing=Number(label.boxesPacking), china=Number(label.boxesChina);
  if(!Number.isFinite(packing)||!Number.isFinite(china))return false;
  return false;
}
function labelPriority(label, containers=[]){
  const co=label?.containerId?containers.find(c=>sameRefId(c.id,label.containerId)):null;
  const status=String(co?.status||label?.status||'prep').toLowerCase();
  const error=labelHasError(label,containers);
  if(['ve'].includes(status)) return error
    ? {key:'orange',icon:'⚠️',label:'Error en Venezuela',title:'Llegó a Venezuela, pero existe una inconsistencia que debe corregirse'}
    : {key:'green',icon:'🟢',label:'En Venezuela',title:'Mercancía llegada a Venezuela'};
  if(['done','closed'].includes(status)) return error
    ? {key:'orange',icon:'⚠️',label:'Error en Venezuela',title:'Proceso marcado como completado, pero existe una inconsistencia'}
    : {key:'green',icon:'✅',label:'Proceso completado',title:'Proceso completado satisfactoriamente'};
  if(status==='transit') return error ? {key:'orange',icon:'⚠️',label:'Error en tránsito',title:'La mercancía está en tránsito pero tiene una inconsistencia'} : {key:'orange',icon:'🟠',label:'En tránsito',title:'Mercancía en tránsito'};
  if(['china','warehouse'].includes(status)) return error ? {key:'red',icon:'⚠️',label:'Revisar en China',title:'La mercancía está en China pero tiene una inconsistencia'} : {key:'yellow',icon:'🟡',label:'En China',title:'Mercancía en almacén de China'};
  return {key:'red',icon:'🔴',label:'Atención',title:'Compra/envío requiere atención'};
}
function fmtDecimal(v){const n=Number(v);return Number.isFinite(n)?n.toFixed(2):'—';}
function advisorUrgentCount(advisorId){
  const clients=db.clients.filter(c=>sameRefId(c.advisorId,advisorId));
  return clients.filter(c=>portfolioPriority(c,db.labels.filter(l=>sameRefId(l.clientId,c.id)),db.containers).key==='red').length;
}
function portfolioPriority(client, labels=[], containers=[]){
  const activeLabels=labels.filter(l=>!l.ready);
  if(!activeLabels.length) return {key:'red',icon:'⚠️',label:'Sin compra/envío',title:'Cliente sin etiquetas activas'};
  const priorities=activeLabels.map(l=>labelPriority(l,containers));
  const rank={red:0,orange:1,yellow:2,green:3};
  const worst=[...priorities].sort((a,b)=>rank[a.key]-rank[b.key])[0];
  if(worst) return worst;
  return {key:'red',icon:'🔴',label:'Requiere atención',title:'Revisar cartera'};
}
function portfolioView(){
  const role=me()?.role||'';
  const advisors=db.users.filter(u=>u.role==='asesora'&&u.active).sort((a,b)=>String(a.name||'').localeCompare(String(b.name||'')));
  const selectedAdvisor=role==='admin'?(portfolioAdvisorFilter||''):String(me()?.id||'');
  const remote=portfolioRemote;
  const clients=remote?.clients||[];
  const labels=remote?.labels||[];
  const containers=remote?.containers||[];
  const selectedClient=portfolioClientFilter && clients.some(c=>sameRefId(c.id,portfolioClientFilter))?String(portfolioClientFilter):'';
  const client=clients.find(c=>sameRefId(c.id,selectedClient));
  const clientLabels=client?labels.filter(l=>sameRefId(l.clientId,client.id)):[];
  const activeClientLabels=clientLabels.filter(l=>!l.ready);
  const readyClientLabels=clientLabels.filter(l=>l.ready);
  const labelRank={red:0,yellow:1,orange:2,green:3};
  const highestPriorityLabel=[...activeClientLabels].sort((a,b)=>(labelRank[labelPriority(a,containers).key]-labelRank[labelPriority(b,containers).key])||String(a.number||'').localeCompare(String(b.number||'')))[0]||null;
  const selectedLabel=portfolioLabelFilter && clientLabels.some(l=>sameRefId(l.id,portfolioLabelFilter))?String(portfolioLabelFilter):'';
  const displayLabel=selectedLabel?clientLabels.find(l=>sameRefId(l.id,selectedLabel)):highestPriorityLabel;
  const clientContainers=client?[...new Set(clientLabels.map(l=>String(l.containerId||'')).filter(Boolean))].map(id=>containers.find(c=>sameRefId(c.id,id))).filter(Boolean):[];
  const priorityFor=c=>portfolioPriority(c,labels.filter(l=>sameRefId(l.clientId,c.id)),containers);
  const sortedClients=[...clients].sort((a,b)=>{const order={red:0,yellow:1,orange:2,green:3};const pa=priorityFor(a),pb=priorityFor(b);return (order[pa.key]-order[pb.key])||String(a.name||'').localeCompare(String(b.name||''));});
  const missing=client?clientBoxesMissing(client):null;
  const advisorControl=role==='admin' ? `<div class="portfolio-select-block"><label>1. Selecciona una asesora</label><select id="portfolioAdvisorFilter" class="inline-select"><option value="">Selecciona una asesora</option>${advisors.map(u=>`<option value="${esc(u.id)}" ${sameRefId(selectedAdvisor,u.id)?'selected':''}>${esc(u.name)}${u.advisorCode?' · '+esc(u.advisorCode):''}</option>`).join('')}</select></div>` : `<div class="portfolio-select-block"><label>Asesora</label><div class="selected-advisor-chip">👤 ${esc(me()?.name||'')}</div></div>`;
  const clientOptions=sortedClients.map(c=>{const p=priorityFor(c);return `<option value="${esc(c.id)}" ${sameRefId(selectedClient,c.id)?'selected':''}>${p.icon} ${esc(c.name||'Sin nombre')}${c.code?' · '+esc(c.code):''} · ${esc(p.label)}</option>`}).join('');
  const labelOptions=activeClientLabels.map((l,idx)=>{const lp=labelPriority(l,containers);return `<option value="${esc(l.id)}" ${sameRefId(selectedLabel,l.id)?'selected':''}>${lp.icon} Compra / envío ${idx+1} · ${esc(l.number||'Sin número')} · ${esc(lp.label)}</option>`}).join('');
  const labelControl=client?`<div class="portfolio-select-block"><label>3. Selecciona una compra / envío</label><select id="portfolioLabelFilter" class="inline-select"><option value="">Todas las compras / envíos</option>${labelOptions}</select><small class="muted">Cada etiqueta representa una compra o envío independiente · ${activeClientLabels.length} activas${readyClientLabels.length?` · ${readyClientLabels.length} listas archivadas`:''}</small></div>`:'';
  const clientControl=selectedAdvisor?`<div class="portfolio-select-block"><label>${role==='admin'?'2. Selecciona un cliente':'Selecciona un cliente'}</label><select id="portfolioClientFilter" class="inline-select"><option value="">Selecciona un cliente</option>${clientOptions}</select><div class="portfolio-priority-legend"><span>🔴 Atención</span><span>🟡 En China</span><span>🟠 En tránsito</span><span>🟢 En Venezuela</span><span>✅ Proceso completado</span><span>⚠️ Error</span></div><small class="muted">${clients.length} cliente(s) en esta cartera · ordenados por prioridad</small></div>${labelControl}`:'';
  let body='';
  if(!selectedAdvisor) body=`<div class="card section portfolio-prompt"><div class="portfolio-prompt-icon">👤</div><h3>Selecciona una asesora</h3><p>Primero selecciona una asesora para cargar su cartera.</p></div>`;
  else if(portfolioLoading) body=`<div class="card section portfolio-prompt"><div class="portfolio-prompt-icon">⏳</div><h3>Cargando cartera…</h3><p>Estamos consultando la información actualizada de la asesora.</p></div>`;
  else if(remote?.error) body=`<div class="card section portfolio-prompt error"><div class="portfolio-prompt-icon">⚠️</div><h3>No se pudo cargar la cartera</h3><p>${esc(remote.error)}</p><button class="btn btn-secondary" id="portfolioRetry">Reintentar</button></div>`;
  else if(!clients.length) body=`<div class="card section portfolio-prompt"><div class="portfolio-prompt-icon">📋</div><h3>Sin clientes asignados</h3><p>Esta asesora no tiene clientes en su cartera actualmente.</p></div>`;
  else if(!client) body=`<div class="card section portfolio-prompt"><div class="portfolio-prompt-icon">🎯</div><h3>Prioriza la cartera</h3><p>Los clientes están ordenados por prioridad. Selecciona uno para ver su mercancía y trazabilidad.</p><div class="portfolio-priority-cards"><div class="priority-summary red"><b>🔴 Atención</b><span>${sortedClients.filter(c=>priorityFor(c).key==='red').length}</span></div><div class="priority-summary yellow"><b>🟡 En China</b><span>${sortedClients.filter(c=>priorityFor(c).key==='yellow').length}</span></div><div class="priority-summary orange"><b>🟠 En tránsito / ⚠️</b><span>${sortedClients.filter(c=>priorityFor(c).key==='orange').length}</span></div><div class="priority-summary green"><b>✅ Correctos</b><span>${sortedClients.filter(c=>priorityFor(c).key==='green').length}</span></div></div></div>`;
  else {
    const priority=priorityFor(client);
    body=`<article class="card portfolio-card portfolio-card-single portfolio-priority-${priority.key}">
      <div class="portfolio-card-head"><div><div class="portfolio-client-priority"><span class="priority-indicator ${priority.key}">${priority.icon}</span><span>${esc(priority.label)}</span></div><span class="code-pill">${esc(client.code||'—')}</span><h3>${esc(client.name)}</h3><p>${esc(client.company||'Sin empresa')} · ${esc(userName(client.advisorId)||me()?.name||'')}</p></div>${badgeStatus('client',client.status)}</div>
      <div class="portfolio-main-grid">${(()=>{const base=displayLabel||{};const cargo=base.cargoType||client.cargoType||'';const fs=base?familySummary(base):null;const bp=base.boxesPacking!==''&&base.boxesPacking!==undefined?base.boxesPacking:(client.boxesPacking??'');const bc=base?(()=>{const fs=familySummary(base);return fs?fs.registered:(base.boxesChina!==''&&base.boxesChina!==undefined?base.boxesChina:(client.boxesChina??''))})():(client.boxesChina??'');const root=fs?.root||base;const cp=root.cbmPacking!==''&&root.cbmPacking!==undefined?root.cbmPacking:(client.cbmPacking??'');const cc=fs?fs.cbmRealTotal:(base.cbmChina!==''&&base.cbmChina!==undefined?base.cbmChina:(client.cbmChina??''));const miss=fs?fs.remaining:((bp===''||bp==null)?null:Math.max(Number(bp)-(Number(bc)||0),0));const allocated=fs?fs.registered:(Number(bc)||0);return `<div><span class="portfolio-label">Tipo de mercancía</span><b>${esc(cargo||'No indicado')}</b></div><div><span class="portfolio-label">Compra / envío</span><b>${displayLabel?esc(displayLabel.number||'—'):'Todas las compras'}</b></div><div><span class="portfolio-label">Fecha(s) de llegada</span><b>${displayLabel?(()=>{const co=containers.find(c=>sameRefId(c.id,displayLabel.containerId));return fmtDate(co?.arrival||co?.eta)||'—'})():clientArrivalLabel(client)}</b></div><div><span class="portfolio-label">Cajas Packing List</span><b>${bp===''?'—':esc(bp)}</b></div><div class="${displayLabel&&labelBoxesMismatch(displayLabel,containers)?'portfolio-data-error':''}"><span class="portfolio-label">Cajas en almacén</span><b>${bc===''?'—':esc(bc)}</b></div><div><span class="portfolio-label">Cajas faltantes</span><b class="${miss>0?'warning-text':''}">${miss==null?'—':miss}</b></div><div><span class="portfolio-label">CBM Packing List</span><b>${cp===''?'—':fmtDecimal(cp)}</b></div><div><span class="portfolio-label">CBM real almacén China</span><b>${cc===''?'—':fmtDecimal(cc)}</b></div>${displayLabel&&labelBoxesMismatch(displayLabel,containers)?`<div class="portfolio-box-error">⚠️ <b>Diferencia de cajas:</b> faltan datos por recibir o registrar en esta operación.</div>`:''}`})()}</div>
      ${displayLabel?(()=>{
        const sl=displayLabel;
        const slp=labelPriority(sl,containers);
        const sco=sl?containers.find(c=>sameRefId(c.id,sl.containerId)):null;
        const familyMembers=(sl?.familyCode?clientLabels.filter(x=>String(x.familyCode||'')===String(sl.familyCode||'')):[]).sort((a,b)=>{
          if(sameRefId(a.id,sl.id))return -1;
          if(a.parentLabelId&&!b.parentLabelId)return 1;
          if(!a.parentLabelId&&b.parentLabelId)return -1;
          return String(a.number||'').localeCompare(String(b.number||''));
        });
        const familyRoot=familyMembers.find(x=>!x.parentLabelId)||sl;
        const familySubs=familyMembers.filter(x=>x.parentLabelId);
        const familyBoxes=familySubs.reduce((n,x)=>n+(Number(x.boxesPacking)||0),0);
        const familyExpected=Number(familyRoot?.boxesPacking||sl.familyExpected||0);
        const familyProgress=(familySubs.length&&familyExpected>0)?Math.min(100,Math.round((familyBoxes/familyExpected)*100)):null;
        return sl?`
          <div class="portfolio-selected-label">
            <div><span class="portfolio-label">${selectedLabel?'Compra / envío seleccionada':'Compra / envío de mayor prioridad'}</span><h4>${slp.icon} ${esc(sl.number||'Sin número')} · ${esc(slp.label)}</h4></div>
            <div class="portfolio-selected-label-meta">${slp.icon} ${esc(slp.title)}${sco?` · Contenedor: ${esc(sco.number||'—')}`:''}<span>Creada: ${fmtDT(sl.createdAt)}</span><span>Última actualización: ${fmtDT(sl.updatedAt||sl.createdAt)}</span></div>
            ${familyMembers.length>1?`<div class="portfolio-family-detail">
              <div class="portfolio-family-detail-head"><b>Grupo de etiquetas</b><span>${familyProgress!==null?`${familyBoxes} / ${esc(familyExpected)} cajas · ${familyProgress}% · ${Math.max(Number(familyExpected)-familyBoxes,0)} restantes`:''}</span></div>
              <div class="portfolio-family-detail-list">${familyMembers.map(x=>{const xco=containers.find(c=>sameRefId(c.id,x.containerId));const boxes=Number(x.boxesPacking||0);const boxLabel=x.parentLabelId?`${boxes} cajas`: `${Number(familyExpected||0)} cajas totales`;return `<div class="portfolio-family-detail-row ${x.parentLabelId?'is-sub':''}"><span>${x.parentLabelId?'↳':'🏷️'} <b>${esc(x.number||'—')}</b>${x.parentLabelId?'<small>Subetiqueta</small>':'<small>Principal · total del grupo</small>'}</span><span>${badgeStatus('label',x.status||'prep')}</span><span>${boxLabel}</span><span>${xco?esc(xco.number||'—'):'Sin contenedor'}</span><span>${x.cbmPacking!==''?fmtDecimal(x.cbmPacking):'—'} CBM</span></div>`}).join('')}</div>
            </div>`:''}
          </div>`:'';
      })():''}
      <div class="portfolio-links">
        <div><span class="portfolio-label">Compras / envíos activas (${activeClientLabels.length})</span>${activeClientLabels.length?`<div class="portfolio-label-list">${activeClientLabels.map((l,idx)=>{const co=containers.find(c=>sameRefId(c.id,l.containerId));const lp=labelPriority(l,containers);return `<div class="portfolio-label-item priority-${lp.key}"><span class="portfolio-priority-emoji" title="${esc(lp.title)}">${lp.icon}</span><div class="portfolio-label-main"><div><b>Compra / envío ${idx+1}</b><span class="muted"> · ${esc(l.number)}</span></div><div class="portfolio-label-meta"><span>${lp.icon} ${esc(lp.label)}</span>${co?`<span>Contenedor: ${esc(co.number||'—')}</span>`:'<span>Sin contenedor</span>'}${badgeStatus('label',co?.status||l.status||'prep')}${labelBoxesMismatch(l,containers)?'<span class="portfolio-error-mini">⚠️ Diferencia de cajas</span>':''}<span>Creada ${fmtDate(l.createdAt)}</span><span>Actualizada ${fmtDate(l.updatedAt||l.createdAt)}</span></div></div></div>`}).join('')}</div>`:'<span class="muted">No hay compras activas.</span>'}${readyClientLabels.length?`<div class="portfolio-archive"><div class="portfolio-label">📁 Archivo de compras / etiquetas listas (${readyClientLabels.length})</div><div class="portfolio-label-list archived">${readyClientLabels.map((l,idx)=>{const co=containers.find(c=>sameRefId(c.id,l.containerId));return `<div class="portfolio-label-item priority-green archived"><span class="priority-dot green">✓</span><div class="portfolio-label-main"><div><b>Compra / envío lista ${idx+1}</b><span class="muted"> · ${esc(l.number)}</span></div><div class="portfolio-label-meta"><span>✓ Lista</span>${co?`<span>Contenedor: ${esc(co.number||'—')}</span>`:'<span>Sin contenedor</span>'}</div></div></div>`}).join('')}</div></div>`:''}</div>
        <div><span class="portfolio-label">Contenedores asociados (${clientContainers.length})</span>${clientContainers.length?clientContainers.map(co=>`<div class="portfolio-container-line"><b>${esc(co.number)}</b> ${badgeStatus('container',co.status)} <span class="muted">Salida: ${fmtDate(co.departure)} · ETA: ${fmtDate(co.eta)} · Llegada: ${fmtDate(co.arrival)}</span></div>`).join(''):'<span class="muted">Sin contenedores asociados.</span>'}</div>
      </div>
      <div class="portfolio-actions"><button class="btn btn-secondary btn-sm" data-action="client-view" data-id="${esc(client.id)}">Ver cliente</button></div>
    </article>`;
  }
  return `<div class="page-head"><div><h1>📦 Cartera y mercancía</h1><p>Consulta la cartera actual de una asesora y prioriza qué cliente atender primero.</p></div><div class="row"><button class="btn btn-secondary" id="portfolioRefresh">↻ Actualizar</button></div></div><div class="card section portfolio-filter-card"><div class="portfolio-filter-grid">${advisorControl}${clientControl}</div></div>${body}`;
}

function renderView(){capturePageSearchValues();if((currentView==='activity'||currentView==='backups'||currentView==='stats'||currentView==='reports')&&me()?.role!=='admin')currentView='dashboard';document.querySelectorAll('.nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===currentView));const p=document.getElementById('page');if(!p)return;const views={dashboard:dashboardView,clients:clientsView,labels:labelsView,containers:containersView,reminders:remindersView,codes:codesView,portfolio:portfolioView,downloads:downloadsView,stats:statsView,activity:activityView,calendar:calendarView,reports:reportsView,complaints:complaintsView,users:usersView,backups:backupsView};p.innerHTML=(views[currentView]||dashboardView)();bindView();if(currentView==='backups')loadBackupStatus()}
