// api/ask.js
import { google } from "googleapis";
import OpenAI from "openai";

// Initialize OpenAI client
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Helper: parse service account JSON stored in env var
function getGoogleAuth() {
  const sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  return new google.auth.GoogleAuth({
    credentials: sa,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"]
  });
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    const { question, spreadsheetId, range } = req.body;

    // Validate
    if (!question) return res.status(400).json({ error: "Missing question" });

    // Choose spreadsheetId & range from server env if you prefer
    const sheetId = spreadsheetId || process.env.SHEET_ID;
    const sheetRange = range || "Sales!A1:D500";

    // 1) Fetch sheet rows
    const auth = getGoogleAuth();
    const sheets = google.sheets({ version: "v4", auth });
    const sheetResp = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: sheetRange
    });
    const rows = sheetResp.data.values || [];

    // Convert to CSV-like small table text (truncate to last N rows if big)
    const maxRowsToSend = 150;
    let sendRows = rows;
    if (rows.length > maxRowsToSend) {
      // prefer the most recent rows: if first column is date, sort client-side is better.
      sendRows = [rows[0], ...rows.slice(-maxRowsToSend+1)]; // keep header + last rows
    }
    const csv = sendRows.map(r => r.map(cell => (cell ?? "")).join(",")).join("\n");

    // 2) Build a compact prompt — instruct model to only use provided data
    const system = `You are an assistant that answers questions only from the provided dataset about a café's sales. Return concise, accurate answers. If you cannot answer from the data, say "INSUFFICIENT_DATA". Do not hallucinate.`;

    const user = `Dataset (CSV with header on first row):\n${csv}\n\nQuestion: ${question}\nAnswer:`;

    // 3) Call OpenAI Chat Completions
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",     // swap to a model you have access to
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ],
      temperature: 0.0,
      max_tokens: 400
    });

    const answer = completion.choices?.[0]?.message?.content ?? null;
    return res.status(200).json({ answer });
  } catch (err) {
    console.error("API error:", err);
    return res.status(500).json({ error: err.message || String(err) });
  }
}
