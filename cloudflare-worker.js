/* ===================================================================
   S4 Sync Agent — "Porteiro" de IA (Cloudflare Worker)
   -------------------------------------------------------------------
   O que faz: recebe a pergunta do site, chama o Google Gemini (camada
   gratuita) com uma base de conhecimento de PROCESSO (sem dados de
   pessoas) e devolve a resposta. A chave da IA fica guardada aqui no
   Cloudflare (secret), nunca no site público.

   Como publicar (passo a passo no painel da Cloudflare):
   1. Crie uma conta grátis em https://dash.cloudflare.com
   2. Workers & Pages -> Create -> Worker -> dê um nome (ex: s4-ia)
   3. Cole TODO este arquivo no editor e clique em Deploy
   4. Settings -> Variables and Secrets -> Add -> tipo "Secret":
        Nome:  GEMINI_API_KEY
        Valor: (sua chave do Google AI Studio - aistudio.google.com)
   5. Faça Deploy de novo. Copie a URL do Worker (ex:
        https://s4-ia.SEU-USUARIO.workers.dev) e me envie.
   =================================================================== */

const ORIGEM_PERMITIDA = "https://dmarinhoc.github.io";  // só o site oficial pode usar
/* tenta estes na ordem; se nenhum existir, o Worker pergunta à API quais
   modelos a chave tem e escolhe um "flash" automaticamente */
const MODELOS = ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-flash-latest"];

/* Base de conhecimento de PROCESSO — SEM nomes/e-mails de pessoas.
   (contatos e Key Users são respondidos localmente pelo site) */
const CONHECIMENTO = `
PROJETO: Migração da Bracell para o SAP S/4HANA (Onda 3). Go Live em 01/07/2026.

PLANO DE CONTINGÊNCIA DE COMPRAS (usado só quando o sistema está indisponível e a compra é urgente/excepcional):
- Quem aciona: o requisitante (solicitante), abrindo uma solicitação no formulário Microsoft Forms.
- Quem aprova: Auditoria, Controladoria e Key Users HANA (aprovação registrada no Forms).
- Quem NÃO pode acionar: compradores e analistas de suprimentos.
- Como a solicitação chega ao comprador: o comprador é indicado pelo requisitante no formulário; quando a solicitação é aprovada ele recebe notificação por e-mail; quando todas as aprovações terminam ele recebe o OK para comprar.
- Critérios para usar a contingência: risco à saúde/segurança; risco ao meio ambiente; impacto na produção; impacto financeiro relevante; risco à imagem da companhia.
- Link do formulário de contingência: https://forms.office.com/Pages/ResponsePage.aspx?id=hJ0tWABIh0SbJM3GRxVRrmA7P1RnlmJCjuOqxvFcgIRUMkZXU1NYMTcxMkNHWU5PM0cyT1hFMFozWC4u
- Como o comprador compra no período sem sistema: por e-mail, seguindo as diretrizes do Plano de Contingência (cotação e formalização por e-mail com rastreabilidade, anexando propostas técnica/comercial e condições gerais). Documento completo: https://bracellsp.sharepoint.com/:b:/s/PROCUREMENT/IQBD7EipIbwnR49mLCSJgA2PAXYJlLXXv9Vpz07oPypFuss?e=0mhKDM
- Fluxo completo: 1) Solicitante abre o Forms; 2) Auditoria/Controladoria/Key Users HANA aprovam; 3) Key User envia ao comprador; 4) comprador faz sourcing e formaliza por e-mail; 5) comprador libera portaria via RH Terceiros; 6) comprador emite o pedido no sistema após a liberação, com documentos comprobatórios.
- Emissão do pedido após o sistema voltar: anexar o formulário aprovado, e-mail de formalização, propostas técnica e comercial, condições gerais e comprovante ao RH Terceiros; registrar nas observações que é oriundo do Plano de Contingência. A emissão no sistema é obrigatória.
- A planilha/status das contingências é enviada 1x ao dia, no primeiro horário, permitindo ver se a demanda está com o gerente da área, com a Controladoria/comitê ou com o comprador, e fazer o follow-up. Líder da frente para questionamentos: Rodrigo Carvalho.

DATAS / PRAZOS DO CUTOVER (ECC = sistema antigo). Todas as datas são limites "até". Atenção: existem TRÊS datas diferentes ligadas a NF — não confundir:
- Cadastro (criação/ampliação/alteração) de BPs, materiais e serviços: até 28/05/2026.
- Criação de requisições de compra (RC): até 01/06/2026.
- Criação de contratos (CT): até 01/06/2026.
- Criação de pedidos de compra (PO): até 10/06/2026.
- Bloqueio de criação de novos PO no ECC: a partir de 11/06/2026.
- Aprovação de documentos de compra (RC/PO/CT) no ECC: até 13/06/2026 (não aprovados não migram).
- Solicitação de provisão (fluxo de caixa) para pagamento de fornecedor: até 15/06/2026.
- Solicitação de antecipação de pagamentos a fornecedores: até 15/06/2026.
- ENVIO de NF (Insumos/MRO/Serviços/Capex/CTe) para Campinas: até 19/06/2026.
- Geração de Aviso de Recebimento (AR): até 19/06/2026.
- ENTRADA de nota fiscal no sistema (NF Insumos/MRO/Serviços/Capex/CTe): até 23/06/2026. (É esta a data quando alguém pergunta "até quando dar entrada / lançar / receber NF no ECC".)
- Entrada de Faturas/Reembolsos (documentos não fiscais): até 23/06/2026.
- Apontamento de produção no ECC: até 23/06/2026.
- Integração da folha de pagamento: de 23/06 a 24/06/2026.
- Data limite de pagamento: 25/06/2026.
- Última data de faturamento: 26/06/2026.
- Fechamento contábil (ECC): de 26/06 a 29/06/2026.
- Blackout ECC: de 24/06 a 28/06/2026 (a partir de 24/06 acesso só ao time de CO; a partir de 28/06 somente consulta).
- Blackout e liberação parcial do ambiente HANA (Faturamento e vendas Celulose e Tissue): de 01/07 a 03/07/2026.
- Liberação total do ambiente HANA: de 03/07 a 06/07/2026.
- Go Live S/4HANA: 01/07/2026.
- RETOMADA do recebimento de notas fiscais no novo sistema: 07/07/2026.
Dica de interpretação: se a dúvida for sobre receber/dar entrada de NF de itens críticos no recebimento físico/almoxarifado, informe a data de ENTRADA de NF (23/06/2026) e sugira confirmar com o Key User da área de Almoxarifado (ou a área responsável pelo item) digitando o nome da área no assistente.

MIGRAÇÃO DE DADOS:
- RC: emitidas entre 01/01 e 01/06/2026, apenas aprovadas.
- PO: aprovadas e com saldo, emitidas entre 01/07/2024 e 10/06/2026.
- Contratos: vigentes e com saldo ativo.
- Documentos fora dos critérios não migram e, se necessário, devem ser recriados desde a requisição pelo requisitante.
- Anexos não migram (ficam no ECC para consulta). Documentos migrados ganham nova numeração no S/4HANA.
- O ECC fica disponível só para consulta após o Go-Live.

NOTAS FISCAIS / NUMERAÇÃO:
- Fornecedores de SP devem enviar NF até 19/06/2026; recebimento suspenso a partir daí e retomado em 07/07/2026.
- A numeração dos pedidos muda no S/4HANA. O fornecedor deve aguardar o novo número do pedido enviado pelo comprador; a NF deve conter o novo número do pedido e o MIGO.

SUPORTE / CHAMADOS NO GO LIVE:
- Escalonamento: 1) usuário aciona o Key User da área; 2) Key User valida e abre chamado com evidências; 3) TI classifica e direciona; 4) consultoria resolve; 5) retorno pelo chamado; 6) Key User valida e fecha.
- Ao reportar erro, incluir descrição, prints e evidências (logs, mensagens, horários, usuários impactados).

IMPORTAÇÕES / MRO:
- ~95% das importações são com pagamento antecipado.
- Pagamento ao fornecedor internacional para liberar embarque: até 20/05/2026. Embarques aéreos: até 30/05/2026. Embarques marítimos fora de curso: 1ª quinzena de julho/2026.

DIVERGÊNCIA DE NF EM MATERIAL/SERVIÇO CRÍTICO DURANTE O FREEZING (período de paralisação/blackout) — por erro no pedido, cadastro de material, IVA etc.:
- Se JÁ EXISTE pedido de compra emitido e a NF está com o time fiscal para lançamento: havendo divergência no pedido, o time de Task Force (Backlog NF) possui acesso às transações de alteração e atua diretamente na tratativa.
- Se NÃO EXISTE pedido de compra e é necessário pagar o fornecedor: o alinhamento deve ser feito diretamente com o time financeiro, que orienta o procedimento adequado.
- Para situações emergenciais: o requisitante formaliza a solicitação pelo formulário do Plano de Contingência.

DELIBERAÇÕES DO S4 SYNC (reunião de 18/06/2026) — regras mais recentes, têm prioridade:

Pedido emitido no ECC que NÃO foi aprovado, mas cuja contratação precisa ser formalizada com o fornecedor (inclui concorrência/cotação já feita):
- NÃO criar novo Forms para esse caso. Usar o fluxo já conhecido: o analista de Suprimentos inclui no DocuSign o BID TAB (Bid Tab) e insere os aprovadores conforme a COA (alçada).
- Após a aprovação no DocuSign, o comprador comunica o fornecedor.
- Quando o SAP S/4HANA estiver liberado, o comprador cria o pedido no S/4 para formalização no sistema, anexando as evidências (Bid Tab, aprovações). Mantém governança e registro para auditoria.

RCs com apontamento em contrato que NÃO geraram pedido:
- A equipe de key user vai remover o vínculo do contrato nessas linhas e prosseguir com a migração das RCs.
- No S/4 essas requisições seguem como COMPRA SPOT, sob responsabilidade do comprador/especialista de Suprimentos (o analista realiza a compra de forma spot).
- Motivo de não migrar com o contrato vinculado: as RCs migram antes dos contratos e muitas estavam ligadas a contratos vencidos, bloqueados, sem saldo ou com valores/quantidades ultrapassados — manter o vínculo poderia gerar erro.
- RCs de ESTOQUE não entram nesse processo; o MRP gera a demanda diretamente no S/4.

Regra de migração de RC: migram as requisições emitidas e aprovadas a partir de 01/01/2026. RCs pendentes de aprovação não migram.

Migração de pedidos e contratos: só podem ser extraídos do ECC a partir de 24/06 (após a entrada de notas até 23/06). A subida/migração está prevista a partir de 02/07, com conclusão prevista em 05/07. A validação em produção (se subiram corretos) só fica disponível após a conclusão das cargas, ~05/07. Principal risco: dependência das cargas predecessoras (material, BP/fornecedor, ampliação, centro de custo, ordem, PEP) — se não estiverem saneadas, a migração do documento de compra pode dar erro.

Fluxo de contingência (detalhado): a contingência formaliza demandas urgentes durante a indisponibilidade/blackout. Passa pela aprovação da área/gestão e depois pelo comitê de contingência/Controladoria. Após aprovação completa, a demanda vai ao comprador indicado. Suprimentos NÃO compra antes da aprovação completa. Aprovação por e-mail do gerente NÃO substitui a aprovação formal no fluxo/formulário correto.

Regularização pós-S/4:
- Demanda que nasceu na contingência SEM RC: a área demandante deve criar a RC no S/4 para o comprador vincular/regularizar o pedido. Todo pedido precisa ter RC vinculada.
- Se já havia RC aprovada no ECC e ela migrou: o comprador captura essa RC e gera o pedido no S/4 (caso diferente da contingência que nasceu sem RC).

Sobre o próprio S4 Sync Agent: é um agente de IA criado para o time de SUPRIMENTOS tirar dúvidas recorrentes (blackout, contingência, key users, datas, regras). NÃO deve ser divulgado como canal geral para toda a companhia — o escopo é Suprimentos. Se o agente não souber responder, acionar o time do projeto para avaliar e incluir a resposta na base.

EMISSÃO DO PEDIDO EM CONTINGÊNCIA (passo a passo do comprador):
1. O comprador cria o pedido no S/4HANA.
2. Anexa ao pedido todos os documentos pertinentes e o e-mail com a solicitação/aprovação do plano de contingência.
3. MEMORIZA o pedido (não salvar definitivamente ainda).
4. Envia via Teams para a Jaqueline Prandini o número do pedido memorizado.
5. A Jaqueline registra o pedido na tabela de exceção e retorna ao comprador autorizando a continuidade.
6. Após o retorno, o comprador salva o pedido definitivamente e segue o fluxo normal.
A estratégia/aprovação segue conforme a COA, sem alterações.

RECEBIMENTO NO ALMOXARIFADO DURANTE O CUTOVER (bloqueios progressivos):
- Datas: recebimento de materiais até 19/06/2026; entrada de nota fiscal até 23/06/2026; retorno do recebimento de materiais em 06/07/2026.
- Blackout do recebimento: de 22/06 a 05/07/2026.
Fluxos durante o blackout do recebimento:
- LIBERADOS sem aprovação (recebidos normalmente): pedidos emergenciais ZEME criados previamente no ECC; e pedidos com saldo igual ou inferior ao ponto de ressuprimento, criados previamente no ECC.
- Demanda emergencial NOVA: seguir o Plano de Contingência de Suprimentos — obrigatório preencher o formulário de formalização da demanda e atender a pelo menos um critério (risco à saúde/segurança; risco ao meio ambiente; impacto na produção; impacto financeiro relevante; risco à imagem; parada de produção). Após aprovação, o material é recebido no almoxarifado.
- Pedido criado/aprovado no ECC que NÃO se enquadra nos casos acima: só pode ser recebido mediante e-mail de liberação. Modelo: Assunto "Liberação Emergencial Recebimento Blackout - NFe/Pedido/Fornecedor/Transportadora"; corpo com a justificativa; enviar para aprovação da Gerência da Área Solicitante e da Gestão dos Almoxarifados. (Os contatos da Gestão dos Almoxarifados aparecem no próprio assistente — oriente o usuário a digitar "gestão dos almoxarifados" ou "liberação emergencial recebimento".)
- Importante: solicitações que não atendam aos critérios não serão recebidas durante o blackout.
`;

const INSTRUCAO = `Você é o "S4 Sync Agent", assistente da migração SAP S/4HANA da Bracell, que ajuda os COMPRADORES com dúvidas. Responda SEMPRE em português do Brasil, de forma objetiva, prática e amigável, em frases curtas ou tópicos.

Como interpretar:
- Entenda a INTENÇÃO mesmo que a pergunta esteja mal formulada, curta, com erros de digitação ou sem acentos. Não exija que o usuário formule "do jeito certo".
- Não responda de forma robótica nem peça para reformular: dê a melhor resposta possível com o que entendeu.
- Se a pergunta puder se referir a mais de uma data/situação (ex.: NF tem "envio para Campinas" 19/06, "entrada no sistema" 23/06 e "retomada do recebimento" 07/07), entregue a data mais provável para a intenção e mencione brevemente as outras para o usuário se localizar.
- Quando a dúvida envolver recebimento físico, entrada de material ou item crítico, dê a data e SUGIRA confirmar com o Key User da área pertinente (ex.: Almoxarifado), orientando a digitar o nome da área no assistente para ver quem é.

Regras:
- Responda APENAS com base no CONTEXTO fornecido. Não invente datas, números, nomes ou links.
- Se realmente não houver nada relacionado no contexto, diga que não tem essa informação na base e oriente procurar a equipe de Compras/Suprimentos. Só faça isso como último recurso.
- Se perguntarem por nomes de pessoas, contatos ou "quem é o Key User", responda que essa informação aparece direto no assistente ao digitar a área (você não tem esses dados aqui).
- Quando a pergunta for sobre o formulário, o documento do plano, ou onde acessar algo, inclua o link correspondente do contexto, exatamente como está.`;

function corsHeaders(){
  return {
    "Access-Control-Allow-Origin": ORIGEM_PERMITIDA,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

/* chama um modelo do Gemini; retorna {texto, diag} */
async function chamarGemini(modelo, key, payload){
  const url = "https://generativelanguage.googleapis.com/v1beta/models/" + modelo + ":generateContent?key=" + key;
  try{
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const j = await r.json();
    const texto = j && j.candidates && j.candidates[0] && j.candidates[0].content
      && j.candidates[0].content.parts && j.candidates[0].content.parts[0]
      ? j.candidates[0].content.parts[0].text : "";
    const diag = "[" + modelo + "] HTTP " + r.status + " " +
      (j && j.error ? (j.error.status + ": " + j.error.message)
                    : (j && j.candidates && j.candidates[0] ? ("finishReason=" + j.candidates[0].finishReason) : "sem candidates"));
    return { texto: texto, diag: diag };
  }catch(e){
    return { texto: "", diag: "[" + modelo + "] exceção: " + e.message };
  }
}

/* pergunta à API quais modelos "flash" a chave tem e suportam generateContent */
async function descobrirModelosFlash(key){
  try{
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?key=" + key + "&pageSize=200");
    const j = await r.json();
    if (!j || !j.models) return [];
    return j.models
      .filter(function(m){ return m.supportedGenerationMethods && m.supportedGenerationMethods.indexOf("generateContent") !== -1; })
      .map(function(m){ return m.name.replace("models/", ""); })
      .filter(function(n){ return n.indexOf("flash") !== -1 && n.indexOf("thinking") === -1; });
  }catch(e){ return []; }
}

export default {
  async fetch(request, env){
    if (request.method === "OPTIONS"){
      return new Response(null, { headers: corsHeaders() });
    }
    if (request.method !== "POST"){
      return new Response("Use POST", { status: 405, headers: corsHeaders() });
    }

    let pergunta = "";
    try {
      const body = await request.json();
      pergunta = (body && body.pergunta ? String(body.pergunta) : "").slice(0, 500);
    } catch(e){
      return new Response(JSON.stringify({ erro: "JSON inválido" }), { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders() } });
    }
    if (!pergunta.trim()){
      return new Response(JSON.stringify({ resposta: "" }), { headers: { "Content-Type": "application/json", ...corsHeaders() } });
    }

    if (!env.GEMINI_API_KEY){
      return new Response(JSON.stringify({ resposta: "", _diag: "GEMINI_API_KEY ausente (secret não configurado ou sem Deploy após adicionar)." }), {
        headers: { "Content-Type": "application/json", ...corsHeaders() }
      });
    }

    const payload = {
      systemInstruction: { parts: [{ text: INSTRUCAO + "\n\nCONTEXTO:\n" + CONHECIMENTO }] },
      contents: [{ role: "user", parts: [{ text: pergunta }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 600 }
    };

    const diags = [];

    /* 1) tenta os modelos preferidos */
    for (const modelo of MODELOS){
      const res = await chamarGemini(modelo, env.GEMINI_API_KEY, payload);
      if (res.texto){
        return new Response(JSON.stringify({ resposta: res.texto }), {
          headers: { "Content-Type": "application/json", ...corsHeaders() }
        });
      }
      diags.push(res.diag);
    }

    /* 2) nenhum funcionou -> descobre os modelos da chave e tenta o primeiro flash */
    const disponiveis = await descobrirModelosFlash(env.GEMINI_API_KEY);
    for (const modelo of disponiveis){
      if (MODELOS.indexOf(modelo) !== -1) continue;
      const res = await chamarGemini(modelo, env.GEMINI_API_KEY, payload);
      if (res.texto){
        return new Response(JSON.stringify({ resposta: res.texto }), {
          headers: { "Content-Type": "application/json", ...corsHeaders() }
        });
      }
      diags.push(res.diag);
      break; /* tenta só o primeiro descoberto para não gastar cota à toa */
    }

    return new Response(JSON.stringify({
      resposta: "",
      _diag: diags.join(" | "),
      _modelos_disponiveis: disponiveis
    }), {
      headers: { "Content-Type": "application/json", ...corsHeaders() }
    });
  }
};
