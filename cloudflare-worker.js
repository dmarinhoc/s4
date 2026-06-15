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
const MODELO = "gemini-2.0-flash";                        // modelo gratuito do Gemini

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
- A relação do que está em contingência é enviada semanalmente pela equipe do projeto.

DATAS / PRAZOS (ECC = sistema antigo):
- Criação de requisições de compra (RC) no ECC: até 01/06/2026.
- Criação de contratos no ECC: até 01/06/2026.
- Criação de pedidos de compra (PO) no ECC: até 10/06/2026.
- Bloqueio de novos PO no ECC: a partir de 11/06/2026.
- Aprovação de documentos RC/PO/CT no ECC: até 13/06/2026 (não aprovados não migram).
- Blackout ECC: 24/06 a 28/06/2026.
- Paralisação geral do sistema: 24/06 a 06/07/2026.
- Liberação parcial do HANA: 01/07 a 03/07/2026. Liberação total do HANA: 03/07 a 06/07/2026.
- Go Live S/4HANA: 01/07/2026. Retomada do recebimento de notas fiscais: 07/07/2026.

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
`;

const INSTRUCAO = `Você é o "S4 Sync Agent", assistente da migração SAP S/4HANA da Bracell, que ajuda os COMPRADORES com dúvidas. Responda SEMPRE em português do Brasil, de forma objetiva, prática e amigável, em frases curtas ou tópicos.
Regras:
- Responda APENAS com base no CONTEXTO fornecido. Não invente datas, números, nomes ou links.
- Se a informação não estiver no contexto, diga que não tem essa informação na base e oriente procurar a equipe de Compras/Suprimentos. NÃO tente adivinhar.
- Se perguntarem por nomes de pessoas, contatos ou "quem é o Key User", responda que essa informação aparece direto no assistente ao digitar a área (você não tem esses dados aqui).
- Mantenha links exatamente como estão no contexto.`;

function corsHeaders(){
  return {
    "Access-Control-Allow-Origin": ORIGEM_PERMITIDA,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
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

    const url = "https://generativelanguage.googleapis.com/v1beta/models/" + MODELO + ":generateContent?key=" + env.GEMINI_API_KEY;
    const payload = {
      systemInstruction: { parts: [{ text: INSTRUCAO + "\n\nCONTEXTO:\n" + CONHECIMENTO }] },
      contents: [{ role: "user", parts: [{ text: pergunta }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 600 }
    };

    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const j = await r.json();
      const texto = j && j.candidates && j.candidates[0] && j.candidates[0].content
        && j.candidates[0].content.parts && j.candidates[0].content.parts[0]
        ? j.candidates[0].content.parts[0].text : "";
      return new Response(JSON.stringify({ resposta: texto || "" }), {
        headers: { "Content-Type": "application/json", ...corsHeaders() }
      });
    } catch(e){
      return new Response(JSON.stringify({ erro: "Falha ao consultar a IA" }), {
        status: 502, headers: { "Content-Type": "application/json", ...corsHeaders() }
      });
    }
  }
};
