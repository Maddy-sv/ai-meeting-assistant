import { GoogleGenAI } from "@google/genai";
import fs from 'fs';

const envFile = fs.readFileSync('.env', 'utf8');
const key = envFile.match(/GEMINI_API_KEY="(.*)"/)?.[1] || envFile.match(/GEMINI_API_KEY=(.*)/)?.[1];
const ai = new GoogleGenAI({ apiKey: key });

async function run() {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-1.5-flash",
      contents: [{ role: "user", parts: [{ text: "Hello" }] }]
    });
    console.log(response.text);
  } catch (e) {
    console.error(e);
  }
}
run();
