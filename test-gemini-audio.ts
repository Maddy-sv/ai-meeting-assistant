import { GoogleGenAI } from "@google/genai";
import fs from 'fs';

const envFile = fs.readFileSync('.env', 'utf8');
const key = envFile.match(/GEMINI_API_KEY=(.*)/)?.[1];
const ai = new GoogleGenAI({ apiKey: key });

async function test() {
  console.log("Key exists:", !!key);
}
test();
