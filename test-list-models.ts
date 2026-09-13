import { GoogleGenAI } from "@google/genai";
import fs from 'fs';

const envFile = fs.readFileSync('.env', 'utf8');
const key = envFile.match(/GEMINI_API_KEY="(.*)"/)?.[1] || envFile.match(/GEMINI_API_KEY=(.*)/)?.[1];
const ai = new GoogleGenAI({ apiKey: key });

async function run() {
  try {
    const models = await ai.models.list();
    for await (const model of models) {
      console.log(model.name);
    }
  } catch (e) {
    console.error(e);
  }
}
run();
