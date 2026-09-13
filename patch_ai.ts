import fs from 'fs';

let content = fs.readFileSync('src/lib/ai.functions.ts', 'utf8');

// 1. Add generateWithRetry helper
const helper = `
async function generateWithRetry(ai: any, params: any, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await ai.models.generateContent(params);
    } catch (err: any) {
      const msg = err?.message || "";
      if ((msg.includes("503") || msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("UNAVAILABLE")) && i < maxRetries - 1) {
        console.warn(\`API \${msg.includes("429") ? "429" : "503"} error, retrying in \${(i+1)*2}s...\`);
        await new Promise(r => setTimeout(r, (i + 1) * 2000));
      } else {
        throw err;
      }
    }
  }
}
`;

if (!content.includes('generateWithRetry')) {
  content = content.replace('import { GoogleGenAI } from "@google/genai";', 'import { GoogleGenAI } from "@google/genai";\n' + helper);
}

// 2. Replace all ai.models.generateContent with generateWithRetry
content = content.replace(/await ai\.models\.generateContent\(/g, "await generateWithRetry(ai, ");

// 3. Optional: fallback transcribeRemoteAudio to gemini-2.5-flash to avoid 3.6 bottleneck
content = content.replace(/model: "gemini-3.6-flash", \/\/ flash natively supports audio \+ image inputs/, 'model: "gemini-2.5-flash", // flash natively supports audio + image inputs');

fs.writeFileSync('src/lib/ai.functions.ts', content);
console.log("Patched ai.functions.ts");
