import { createSign, randomInt } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(process.argv[2] ?? '.env');
const env = await loadEnv(envPath);
const corpus = JSON.parse(await readFile(resolve(here, 'corpus.json'), 'utf8'));
const deepLIsFree = env.DEEPL_AUTH_KEY?.endsWith(':fx') ?? false;

const requiredEnvironment = [
  'GOOGLE_CLOUD_PROJECT',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'AZURE_TRANSLATOR_KEY',
  'AZURE_TRANSLATOR_REGION',
  'AZURE_TRANSLATOR_ENDPOINT',
  'DEEPL_AUTH_KEY',
  'DEEPL_API_URL',
];

for (const key of requiredEnvironment) {
  if (!env[key]) throw new Error(`${key} is missing from ${envPath}`);
}

console.log('Generating Google Cloud Translation outputs...');
const googleOutputs = await generateGoogle(corpus, env);
console.log('Generating Azure AI Translator outputs...');
const azureOutputs = await generateAzure(corpus, env);
console.log('Generating DeepL outputs...');
const deeplOutputs = await generateDeepL(corpus, env);

const providerEntries = shuffle([
  {
    key: 'google',
    name: 'Google Cloud Translation Advanced',
    configuration: 'General NMT model; general Spanish, Portuguese, and French targets; Haitian Creole target.',
    outputs: googleOutputs,
  },
  {
    key: 'azure',
    name: 'Azure AI Translator',
    configuration: 'Standard NMT; explicit Canadian French; Portuguese defaults to Brazilian Portuguese.',
    outputs: azureOutputs,
  },
  {
    key: 'deepl',
    name: deepLIsFree ? 'DeepL API Free (provisional quality test)' : 'DeepL paid API',
    configuration: 'Default text model; explicit Brazilian Portuguese; general Spanish and French; Haitian Creole target.',
    operationalConstraint: deepLIsFree
      ? 'Quality evidence only. Alpha selection requires a paid account and verification of paid-plan data terms.'
      : null,
    outputs: deeplOutputs,
  },
]).map((provider, index) => ({ ...provider, blindId: `Provider ${String.fromCharCode(65 + index)}` }));

const data = {
  generatedAt: new Date().toISOString(),
  evaluationRules: {
    dimensions: {
      meaning: { label: 'Meaning preserved', weight: 0.4 },
      readability: { label: 'Readable and natural', weight: 0.25 },
      terminology: { label: 'Terminology and context', weight: 0.2 },
      effort: { label: 'Low review effort', weight: 0.15 },
    },
    scoreScale: '1 = unacceptable, 3 = usable after edits, 5 = publication-ready wording',
    weighting: 'Each locale contributes equally. Safety-sensitive segments count twice within each locale.',
    eligibility: 'A provider is ineligible if any output is marked unacceptable or any safety-sensitive output receives a meaning score of 1 or 2.',
    tieRule: 'Scores within 0.25 points are a quality tie; use the revealed operational comparison rather than claiming a quality winner.',
  },
  corpus,
  providers: providerEntries,
};

await writeFile(resolve(here, 'comparison-data.json'), `${JSON.stringify(data, null, 2)}\n`);
await writeFile(resolve(here, 'translation-provider-review.html'), renderHtml(data));
console.log(`Generated ${resolve(here, 'translation-provider-review.html')}`);

async function loadEnv(path) {
  const text = await readFile(path, 'utf8');
  return Object.fromEntries(
    text
      .split(/\r?\n/u)
      .filter((line) => line && !line.trimStart().startsWith('#'))
      .map((line) => {
        const separator = line.indexOf('=');
        return separator === -1 ? [line, ''] : [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

async function requestJson(url, init, provider) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(45_000) });
  const body = await response.text();
  if (!response.ok) throw new Error(`${provider} returned HTTP ${response.status}: ${body.slice(0, 1_000)}`);
  return JSON.parse(body);
}

function base64Url(value) {
  return Buffer.from(value).toString('base64url');
}

async function googleAccessToken(credentialsPath) {
  const credentials = JSON.parse(await readFile(credentialsPath, 'utf8'));
  const now = Math.floor(Date.now() / 1_000);
  const unsigned = `${base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64Url(
    JSON.stringify({
      iss: credentials.client_email,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3_600,
    }),
  )}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  const assertion = `${unsigned}.${signer.sign(credentials.private_key, 'base64url')}`;
  const token = await requestJson(
    'https://oauth2.googleapis.com/token',
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    },
    'Google OAuth',
  );
  return token.access_token;
}

async function generateGoogle(sourceCorpus, environment) {
  const accessToken = await googleAccessToken(environment.GOOGLE_APPLICATION_CREDENTIALS);
  const outputs = {};
  for (const locale of sourceCorpus.targetLocales) {
    const body = await requestJson(
      `https://translation.googleapis.com/v3/projects/${encodeURIComponent(environment.GOOGLE_CLOUD_PROJECT)}/locations/global:translateText`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
          'x-goog-user-project': environment.GOOGLE_CLOUD_PROJECT,
        },
        body: JSON.stringify({
          sourceLanguageCode: 'en',
          targetLanguageCode: locale.providerCodes.google,
          mimeType: 'text/plain',
          contents: sourceCorpus.segments.map((segment) => segment.source),
        }),
      },
      'Google Cloud Translation',
    );
    outputs[locale.id] = Object.fromEntries(
      sourceCorpus.segments.map((segment, index) => [segment.id, body.translations[index].translatedText]),
    );
  }
  return outputs;
}

async function generateAzure(sourceCorpus, environment) {
  const endpoint = environment.AZURE_TRANSLATOR_ENDPOINT.replace(/\/$/u, '');
  const query = new URLSearchParams({ 'api-version': '3.0', from: 'en' });
  for (const locale of sourceCorpus.targetLocales) query.append('to', locale.providerCodes.azure);
  const body = await requestJson(
    `${endpoint}/translate?${query}`,
    {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': environment.AZURE_TRANSLATOR_KEY,
        'Ocp-Apim-Subscription-Region': environment.AZURE_TRANSLATOR_REGION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(sourceCorpus.segments.map((segment) => ({ Text: segment.source }))),
    },
    'Azure AI Translator',
  );
  const outputs = Object.fromEntries(sourceCorpus.targetLocales.map((locale) => [locale.id, {}]));
  body.forEach((result, segmentIndex) => {
    sourceCorpus.targetLocales.forEach((locale, localeIndex) => {
      outputs[locale.id][sourceCorpus.segments[segmentIndex].id] = result.translations[localeIndex].text;
    });
  });
  return outputs;
}

async function generateDeepL(sourceCorpus, environment) {
  const configuredEndpoint = environment.DEEPL_API_URL.replace(/\/$/u, '');
  const endpoint = environment.DEEPL_AUTH_KEY.endsWith(':fx') ? 'https://api-free.deepl.com' : configuredEndpoint;
  const outputs = {};
  for (const locale of sourceCorpus.targetLocales) {
    const body = await requestJson(
      `${endpoint}/v2/translate`,
      {
        method: 'POST',
        headers: {
          Authorization: `DeepL-Auth-Key ${environment.DEEPL_AUTH_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: sourceCorpus.segments.map((segment) => segment.source),
          source_lang: 'EN',
          target_lang: locale.providerCodes.deepl,
        }),
      },
      'DeepL',
    );
    outputs[locale.id] = Object.fromEntries(
      sourceCorpus.segments.map((segment, index) => [segment.id, body.translations[index].text]),
    );
  }
  return outputs;
}

function shuffle(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function renderHtml(comparison) {
  const encodedData = JSON.stringify(comparison).replaceAll('</script>', '<\\/script>');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Managed Translation Provider Review</title>
  <style>
    :root { color-scheme: light; --ink:#17231f; --paper:#f5f1e7; --card:#fffdf7; --line:#d5cdbd; --teal:#126b60; --rust:#a7462a; --gold:#d9a62e; --muted:#66706b; }
    * { box-sizing: border-box; }
    body { margin:0; background:linear-gradient(145deg,#e8efe7 0,#f5f1e7 36%,#efe5d5 100%); color:var(--ink); font-family:Georgia,'Times New Roman',serif; min-height:100vh; }
    button,select,textarea,input { font:inherit; }
    button { cursor:pointer; }
    .shell { width:min(1500px,100%); margin:auto; padding:28px; }
    header { display:grid; grid-template-columns:1fr auto; gap:24px; align-items:end; border-bottom:2px solid var(--ink); padding-bottom:20px; }
    .eyebrow { color:var(--teal); font:700 12px/1.2 Arial,sans-serif; letter-spacing:.18em; text-transform:uppercase; }
    h1 { font-size:clamp(34px,5vw,68px); line-height:.92; letter-spacing:-.045em; margin:8px 0 12px; max-width:850px; }
    .lede { color:var(--muted); max-width:760px; margin:0; font-size:17px; line-height:1.5; }
    .progress { min-width:230px; text-align:right; font-family:Arial,sans-serif; }
    .progress strong { display:block; font-size:32px; }
    .bar { height:8px; margin-top:8px; border:1px solid var(--ink); background:#fff; }
    .bar span { display:block; height:100%; background:var(--gold); transition:width .2s; }
    .toolbar { display:flex; gap:10px; flex-wrap:wrap; padding:18px 0; }
    .toolbar button,.nav button { border:1px solid var(--ink); background:var(--card); padding:10px 14px; border-radius:999px; box-shadow:2px 2px 0 var(--ink); }
    .toolbar button:disabled,.nav button:disabled { opacity:.4; cursor:not-allowed; box-shadow:none; }
    .toolbar .primary { background:var(--teal); color:white; }
    .brief { display:grid; grid-template-columns:1.35fr 1fr; gap:18px; margin:12px 0 20px; }
    .source,.focus { border:1px solid var(--line); background:rgba(255,253,247,.82); padding:20px; }
    .source h2 { font-size:25px; margin:6px 0 10px; }
    .source blockquote { font-size:clamp(21px,2.4vw,34px); line-height:1.25; margin:18px 0; }
    .meta { color:var(--muted); font:14px/1.5 Arial,sans-serif; }
    .risk { display:inline-block; color:#fff; background:var(--rust); padding:4px 8px; font:700 11px Arial,sans-serif; letter-spacing:.08em; text-transform:uppercase; }
    .locale-note { border-left:4px solid var(--gold); padding-left:12px; }
    .providers { display:grid; grid-template-columns:repeat(3,1fr); gap:14px; }
    .provider { background:var(--card); border:1px solid var(--ink); box-shadow:5px 5px 0 rgba(23,35,31,.16); padding:18px; }
    .provider h3 { display:flex; justify-content:space-between; margin:0 0 12px; font-size:22px; }
    .output { min-height:130px; border-top:1px solid var(--line); border-bottom:1px solid var(--line); padding:16px 0; font-size:18px; line-height:1.45; white-space:pre-wrap; }
    .scores { display:grid; grid-template-columns:1fr auto; gap:9px 12px; margin-top:16px; font:13px Arial,sans-serif; align-items:center; }
    select { min-width:74px; border:1px solid var(--line); background:white; padding:7px; }
    .critical { margin:16px 0 8px; color:var(--rust); font:700 13px Arial,sans-serif; }
    textarea { width:100%; min-height:62px; resize:vertical; border:1px solid var(--line); background:white; padding:9px; font:13px/1.4 Arial,sans-serif; }
    .nav { display:flex; justify-content:space-between; align-items:center; padding:24px 0; font-family:Arial,sans-serif; }
    .summary { display:none; margin-top:22px; }
    .summary.visible { display:block; }
    .summary-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:14px; }
    .result { border:1px solid var(--ink); background:var(--card); padding:18px; }
    .result .total { font-size:42px; font-weight:bold; }
    .ineligible { color:var(--rust); font:700 12px Arial,sans-serif; text-transform:uppercase; }
    .operations { overflow:auto; margin-top:18px; }
    table { width:100%; border-collapse:collapse; background:var(--card); }
    th,td { border:1px solid var(--line); padding:11px; text-align:left; vertical-align:top; }
    th { background:#e4eadf; }
    details { margin-top:18px; font:13px Arial,sans-serif; }
    pre { max-height:280px; overflow:auto; background:#17231f; color:#f5f1e7; padding:14px; }
    @media (max-width:950px) { .providers,.summary-grid { grid-template-columns:1fr; } .brief { grid-template-columns:1fr; } header { grid-template-columns:1fr; } .progress { text-align:left; } }
    @media (max-width:560px) { .shell { padding:16px; } h1 { font-size:42px; } .provider { padding:14px; } .toolbar button { flex:1; } }
  </style>
</head>
<body>
  <main class="shell">
    <header>
      <div><div class="eyebrow">Throwaway prototype · blind review</div><h1>Which translation draft earns trust?</h1><p class="lede">Score wording, not brands. Every provider translated the same author-controlled school-health corpus. No Student data was sent.</p></div>
      <div class="progress"><strong id="progress-count">0 / 32</strong><span>review cases complete</span><div class="bar"><span id="progress-bar"></span></div></div>
    </header>
    <div class="toolbar"><button id="export" class="primary">Download review results</button><button id="reveal" disabled>Reveal providers after all scores</button><button id="reset">Clear in-memory scores</button></div>
    <section id="review">
      <div class="brief"><article class="source"><div class="eyebrow" id="case-label"></div><h2 id="case-title"></h2><span id="risk"></span><blockquote id="source"></blockquote><p class="meta" id="context"></p></article><aside class="focus"><div class="eyebrow">Reviewer brief</div><p id="focus"></p><p class="meta locale-note" id="locale-note"></p><p class="meta"><strong>Scale:</strong> 1 unacceptable · 3 usable after edits · 5 publication-ready.</p></aside></div>
      <div class="providers" id="providers"></div>
      <div class="nav"><button id="previous">Previous case</button><strong id="case-position"></strong><button id="next">Next case</button></div>
    </section>
    <section class="summary" id="summary"><div class="eyebrow">Completed evaluation</div><h2>Blind quality result</h2><p id="recommendation"></p><div class="summary-grid" id="summary-grid"></div><div id="revealed-operations"></div></section>
    <details><summary>Full in-memory state</summary><pre id="state"></pre></details>
  </main>
  <script>const DATA=${encodedData};</script>
  <script>
    const cases = DATA.corpus.targetLocales.flatMap(locale => DATA.corpus.segments.map(segment => ({ locale, segment })));
    const scores = {};
    let current = 0;
    let identitiesRevealed = false;
    const dimensions = Object.entries(DATA.evaluationRules.dimensions);
    const byId = id => document.getElementById(id);

    function scoreKey(item, provider) { return item.locale.id + ':' + item.segment.id + ':' + provider.blindId; }
    function emptyScore() { return { meaning:'', readability:'', terminology:'', effort:'', unacceptable:false, notes:'', suggestedEdit:'' }; }
    function getScore(item, provider) { const key=scoreKey(item,provider); return scores[key] ?? (scores[key]=emptyScore()); }
    function isProviderComplete(value) { return dimensions.every(([key]) => value[key] !== '') && (!value.unacceptable || value.notes.trim()); }
    function isCaseComplete(item) { return DATA.providers.every(provider => isProviderComplete(getScore(item,provider))); }
    function completedCases() { return cases.filter(isCaseComplete).length; }

    function render() {
      const item=cases[current];
      byId('case-label').textContent=item.locale.label+' · '+item.segment.category;
      byId('case-title').textContent=item.segment.id.replaceAll('-',' ');
      byId('source').textContent=item.segment.source;
      byId('context').textContent=item.segment.context;
      byId('focus').textContent=item.segment.reviewFocus;
      byId('locale-note').textContent=item.locale.targetingNote;
      byId('risk').innerHTML=item.segment.safetySensitive?'<span class="risk">Double-weighted safety content</span>':'';
      byId('case-position').textContent=(current+1)+' of '+cases.length;
      byId('previous').disabled=current===0;
      byId('next').disabled=current===cases.length-1;
      byId('providers').innerHTML='';
      DATA.providers.forEach(provider => byId('providers').append(providerCard(item,provider)));
      updateProgress();
      if (completedCases()===cases.length) renderSummary(); else byId('summary').classList.remove('visible');
      byId('state').textContent=JSON.stringify({scores,identitiesRevealed},null,2);
    }

    function providerCard(item,provider) {
      const value=getScore(item,provider);
      const card=document.createElement('article'); card.className='provider';
      const title=document.createElement('h3'); title.innerHTML='<span>'+provider.blindId+'</span><span>'+(isProviderComplete(value)?'✓':'')+'</span>'; card.append(title);
      const output=document.createElement('div'); output.className='output'; output.textContent=provider.outputs[item.locale.id][item.segment.id]; card.append(output);
      const scoreGrid=document.createElement('div'); scoreGrid.className='scores';
      dimensions.forEach(([key,definition]) => {
        const label=document.createElement('label'); label.textContent=definition.label; label.htmlFor=scoreKey(item,provider)+':'+key;
        const select=document.createElement('select'); select.id=label.htmlFor; select.innerHTML='<option value="">Score</option>'+[1,2,3,4,5].map(n=>'<option>'+n+'</option>').join(''); select.value=value[key];
        select.addEventListener('change',()=>{value[key]=select.value; render();}); scoreGrid.append(label,select);
      }); card.append(scoreGrid);
      const critical=document.createElement('label'); critical.className='critical'; const checkbox=document.createElement('input'); checkbox.type='checkbox'; checkbox.checked=value.unacceptable; checkbox.addEventListener('change',()=>{value.unacceptable=checkbox.checked; render();}); critical.append(checkbox,' Unacceptable failure'); card.append(critical);
      const notes=document.createElement('textarea'); notes.placeholder=value.unacceptable?'Required: explain the unacceptable failure':'Review notes (optional)'; notes.value=value.notes; notes.addEventListener('input',()=>{value.notes=notes.value; updateProgress();}); card.append(notes);
      const edit=document.createElement('textarea'); edit.placeholder='Suggested reviewed wording (optional)'; edit.value=value.suggestedEdit; edit.addEventListener('input',()=>{value.suggestedEdit=edit.value; byId('state').textContent=JSON.stringify({scores,identitiesRevealed},null,2);}); card.append(edit);
      return card;
    }

    function updateProgress() {
      const complete=completedCases(); byId('progress-count').textContent=complete+' / '+cases.length; byId('progress-bar').style.width=(complete/cases.length*100)+'%'; byId('reveal').disabled=complete!==cases.length;
      byId('state').textContent=JSON.stringify({scores,identitiesRevealed},null,2);
    }

    function providerSummary(provider) {
      const localeScores=DATA.corpus.targetLocales.map(locale => {
        let weighted=0,totalWeight=0; const dimensionTotals=Object.fromEntries(dimensions.map(([key])=>[key,0]));
        DATA.corpus.segments.forEach(segment => { const weight=segment.safetySensitive?2:1; const value=scores[locale.id+':'+segment.id+':'+provider.blindId]; dimensions.forEach(([key,definition])=>{dimensionTotals[key]+=Number(value[key])*weight*definition.weight;}); weighted+=weight; totalWeight+=weight; });
        return { total:Object.values(dimensionTotals).reduce((a,b)=>a+b,0)/totalWeight };
      });
      const total=localeScores.reduce((sum,item)=>sum+item.total,0)/localeScores.length;
      const failures=cases.filter(item=>{const value=scores[scoreKey(item,provider)]; return value.unacceptable || (item.segment.safetySensitive && Number(value.meaning)<=2);});
      return {provider,total,failures,operationalConstraint:provider.operationalConstraint??null};
    }

    function renderSummary() {
      const summaries=DATA.providers.map(providerSummary).sort((a,b)=>b.total-a.total);
      byId('summary').classList.add('visible'); byId('summary-grid').innerHTML='';
      summaries.forEach(item=>{const card=document.createElement('article');card.className='result';card.innerHTML='<div class="eyebrow">'+item.provider.blindId+'</div><div class="total">'+item.total.toFixed(2)+'</div><p>weighted score out of 5</p>'+(item.failures.length?'<p class="ineligible">Ineligible · '+item.failures.length+' safety gate(s)</p>':'<p>Passed safety gate</p>')+(item.operationalConstraint?'<p class="ineligible">Provisional · paid-plan gate open</p>':'');byId('summary-grid').append(card);});
      const eligible=summaries.filter(item=>item.failures.length===0); let text;
      if(!eligible.length) text='No provider passed the precommitted safety gate. Do not select a provider from this corpus; revise the workflow or candidates.';
      else if(eligible.length>1 && eligible[0].total-eligible[1].total<=0.25) text=eligible[0].provider.blindId+' and '+eligible[1].provider.blindId+' are within the 0.25 quality-tie threshold. Treat quality as tied and decide from operational fit after revealing identities.';
      else text=eligible[0].provider.blindId+' leads the quality evaluation under the precommitted scoring rules.'+(eligible[0].operationalConstraint?' It cannot be selected unconditionally until its paid-plan gate is closed.':'');
      byId('recommendation').textContent=text;
      if(identitiesRevealed) renderOperations();
    }

    function renderOperations() {
      const rows=DATA.providers.map(provider=>'<tr><th>'+provider.blindId+'</th><td><strong>'+provider.name+'</strong><br>'+provider.configuration+(provider.operationalConstraint?'<br><em>'+provider.operationalConstraint+'</em>':'')+'</td></tr>').join('');
      byId('revealed-operations').innerHTML='<div class="operations"><h3>Identity reveal and operational context</h3><table><tr><th>Blind label</th><th>Provider and tested configuration</th></tr>'+rows+'</table><p class="meta">If quality is tied: Google best matches the selected Firebase/Google Cloud architecture and has strong explicit data-use terms and mature glossaries; Azure has lower published standard pricing and explicit fr-CA targeting but weaker Haitian Creole customization; DeepL requires account-specific glossary verification and does not explicitly target fr-CA. Reviewed Managed Translations remain application-owned behind one provider seam regardless of selection.</p></div>';
    }

    function exportResults() {
      const payload={exportedAt:new Date().toISOString(),generatedAt:DATA.generatedAt,evaluationRules:DATA.evaluationRules,localeChoices:DATA.corpus.targetLocales.map(({id,label})=>({id,label})),scores,identitiesRevealed,providerMapping:identitiesRevealed?Object.fromEntries(DATA.providers.map(p=>[p.blindId,p.name])):null};
      const blob=new Blob([JSON.stringify(payload,null,2)+'\\n'],{type:'application/json'}); const link=document.createElement('a'); link.href=URL.createObjectURL(blob); link.download='managed-translation-provider-review-results.json'; link.click(); URL.revokeObjectURL(link.href);
    }

    byId('previous').addEventListener('click',()=>{if(current>0){current--;render();scrollTo({top:0,behavior:'smooth'});}});
    byId('next').addEventListener('click',()=>{if(current<cases.length-1){current++;render();scrollTo({top:0,behavior:'smooth'});}});
    byId('export').addEventListener('click',exportResults);
    byId('reveal').addEventListener('click',()=>{identitiesRevealed=true;renderSummary();byId('reveal').disabled=true;byId('reveal').textContent='Provider identities revealed';});
    byId('reset').addEventListener('click',()=>{if(confirm('Clear every in-memory score and note?')){Object.keys(scores).forEach(key=>delete scores[key]);identitiesRevealed=false;current=0;render();}});
    render();
  </script>
</body>
</html>\n`;
}
