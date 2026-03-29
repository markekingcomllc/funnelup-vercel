/**
 * MARKEKINGCOM — Lead Proxy per FunnelUp (GoHighLevel)
 * 
 * Riceve i dati dal form del sito, crea il contatto in FunnelUp,
 * assegna tag automatici in base al budget e crea un'opportunità
 * nella pipeline "Sessione Strategica".
 * 
 * ENV VARIABLES (da configurare in Vercel):
 * - GHL_API_KEY          → API key di FunnelUp/GHL (Settings > Business Profile > API)
 * - GHL_LOCATION_ID      → Location ID di FunnelUp
 * - GHL_PIPELINE_ID      → ID della pipeline "Sessione Strategica"
 * - GHL_STAGE_ID         → ID dello stage iniziale (es. "Nuovo Lead")
 * - ALLOWED_ORIGIN       → https://markekingcom.com (per CORS)
 */

const GHL_BASE = "https://services.leadconnectorhq.com";

// === CORS Headers ===
function corsHeaders(origin) {
  const allowed = process.env.ALLOWED_ORIGIN || "https://markekingcom.com";
  return {
    "Access-Control-Allow-Origin": origin === allowed ? allowed : allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };
}

// === Tag mapping per budget ===
function budgetToTags(budget) {
  const tags = ["web-form", "sessione-strategica"];
  switch (budget) {
    case "1000-3000":
      tags.push("budget-entry", "livello-growth");
      break;
    case "3000-7000":
      tags.push("budget-mid", "livello-sistema");
      break;
    case "7000-15000":
      tags.push("budget-high", "livello-retainer");
      break;
    case "15000+":
      tags.push("budget-premium", "livello-partnership");
      break;
  }
  return tags;
}

// === Monetary value mapping ===
function budgetToValue(budget) {
  switch (budget) {
    case "1000-3000": return 2000;
    case "3000-7000": return 5000;
    case "7000-15000": return 11000;
    case "15000+": return 20000;
    default: return 1500;
  }
}

// === Goal mapping per tag ===
function goalToTag(goal) {
  const map = {
    "ads-funnel": "obiettivo-ads-funnel",
    "crm-auto": "obiettivo-automazione",
    "production": "obiettivo-produzione",
    "strategy": "obiettivo-strategia",
    "other": "obiettivo-altro",
  };
  return map[goal] || "obiettivo-generico";
}

// === GHL API call ===
async function ghlFetch(endpoint, body) {
  const res = await fetch(`${GHL_BASE}${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GHL_API_KEY}`,
      "Content-Type": "application/json",
      Version: "2021-07-28",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`GHL API ${res.status}: ${errText}`);
  }
  return res.json();
}

// === Main handler ===
export default async function handler(req, res) {
  const origin = req.headers.origin || "";

  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(200, corsHeaders(origin));
    res.end();
    return;
  }

  // Solo POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Headers CORS
  Object.entries(corsHeaders(origin)).forEach(([k, v]) => res.setHeader(k, v));

  try {
    const { name, phone, email, website, budget, goal, context } = req.body;

    // Validazione base
    if (!name || !email || !phone) {
      return res.status(400).json({
        success: false,
        error: "Campi obbligatori: nome, email, telefono",
      });
    }

    // Separa nome/cognome
    const nameParts = name.trim().split(" ");
    const firstName = nameParts[0] || name;
    const lastName = nameParts.slice(1).join(" ") || "";

    // Tags automatici
    const tags = [
      ...budgetToTags(budget),
      goalToTag(goal),
    ];

    // 1. CREA CONTATTO in FunnelUp
    const contact = await ghlFetch("/contacts/", {
      locationId: process.env.GHL_LOCATION_ID,
      firstName,
      lastName,
      email,
      phone,
      website: website || "",
      tags,
      source: "Website Form - Homepage",
      customFields: [
        { key: "budget_range", value: budget || "non specificato" },
        { key: "obiettivo", value: goal || "non specificato" },
        { key: "contesto", value: context || "" },
      ],
    });

    const contactId = contact.contact?.id;

    if (!contactId) {
      throw new Error("Contatto creato ma ID non restituito");
    }

    // 2. CREA OPPORTUNITÀ nella pipeline (se configurata)
    let opportunity = null;
    if (process.env.GHL_PIPELINE_ID && process.env.GHL_STAGE_ID) {
      opportunity = await ghlFetch("/opportunities/", {
        locationId: process.env.GHL_LOCATION_ID,
        pipelineId: process.env.GHL_PIPELINE_ID,
        pipelineStageId: process.env.GHL_STAGE_ID,
        contactId,
        name: `Sessione Strategica — ${firstName} ${lastName}`.trim(),
        status: "open",
        monetaryValue: budgetToValue(budget),
      });
    }

    // 3. Risposta successo
    return res.status(200).json({
      success: true,
      message: "Candidatura ricevuta! Ti contatteremo a breve.",
      contactId,
      opportunityId: opportunity?.opportunity?.id || null,
    });

  } catch (err) {
    console.error("Lead proxy error:", err);
    return res.status(500).json({
      success: false,
      error: "Si è verificato un errore. Riprova o contattaci direttamente.",
    });
  }
}
