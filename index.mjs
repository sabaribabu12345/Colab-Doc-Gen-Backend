// index.mjs
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import puppeteer from "puppeteer";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: "500mb" }));
app.use(bodyParser.urlencoded({ limit: "500mb", extended: true }));

const PORT = process.env.PORT || 5004;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
console.log("🔑 OpenAI API Key loaded:", !!OPENAI_API_KEY);

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

import { marked } from "marked";

// ✅ Generate PDF using Puppeteer
async function generatePDF(content) {
  const outputDir = path.join(process.cwd(), "output");
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

  const pdfPath = path.join(outputDir, "documentation.pdf");
  const htmlContent = marked.parse(content);

  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  await page.setContent(`
        <html>
            <head>
                <title>Colab Documentation</title>
                <style>
                    body { font-family: 'Segoe UI', sans-serif; padding: 30px; line-height: 1.6; color: #333; background-color: #fff; }
                    h1, h2, h3 { color: #5a00cc; margin-top: 20px; }
                    code { background: #f5f5f5; padding: 2px 5px; border-radius: 4px; }
                    pre { background: #f5f5f5; padding: 10px; overflow-x: auto; border-radius: 4px; }
                    ul { margin-left: 20px; }
                </style>
            </head>
            <body>${htmlContent}</body>
        </html>
    `);

  await page.pdf({ path: pdfPath, format: "A4", printBackground: true });
  await browser.close();
  return pdfPath;
}

// ✅ Download endpoint
app.get("/download", (req, res) => {
  const filePath = path.join(process.cwd(), "output", "documentation.pdf");
  if (fs.existsSync(filePath)) res.download(filePath);
  else res.status(404).json({ error: "PDF not found. Please generate it first." });
});

// ✅ Upload notebooks endpoint
app.post("/upload", async (req, res) => {
  const { notebooks, language } = req.body;
  if (!notebooks || notebooks.length === 0)
    return res.status(400).json({ error: "No notebook files provided" });

  try {
    // Step 1: Process notebooks
    const contents = notebooks
      .map((notebook, index) => {
        const filePath = path.join(process.cwd(), "scripts", `uploaded_notebook_${index}.ipynb`);
        fs.writeFileSync(filePath, notebook);

        const result = JSON.parse(execSync(`python3 scripts/process_notebook.py ${filePath}`));
        return result.markdown.concat(result.code).join("\n");
      })
      .join("\n\n");

    // Step 2: Generate base documentation
    const firstPrompt = `
You are a professional technical writer and software architect. Generate comprehensive, professional documentation for the following code. Explain purpose, logic, and architecture. Language: ${language}.
${contents}
    `;

    const baseDocResponse = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [{ role: "user", content: firstPrompt }],
      temperature: 0.7,
      max_tokens: 2048,
    });

    const baseDoc = baseDocResponse.choices[0].message.content;

    // Step 3: Enhance documentation for formatting
    const enhancementPrompt = `
🎯 You are a markdown formatter and technical storyteller.
Take the following plain documentation and transform it into a beautifully formatted markdown document with headings, bullet points, and emojis. Keep it professional but attractive.
${baseDoc}
    `;

    const styledDocResponse = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [{ role: "user", content: enhancementPrompt }],
      temperature: 0.7,
      max_tokens: 2048,
    });

    const finalDoc = styledDocResponse.choices[0].message.content;

    console.log("✅ Final Enhanced Documentation Generated");
    await generatePDF(finalDoc);

    res.json({ documentation: finalDoc });
  } catch (error) {
    console.error("❌ Error during documentation generation:", error.message);
    res.status(500).json({ error: "Error processing notebooks and formatting" });
  }
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
