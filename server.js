import express from "express";
import cors from "cors";
import fileUpload from "express-fileupload";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { OpenAI } from "openai";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 10000;

// =============== 🌐 基础设置 ===============
app.use(cors({
  origin: process.env.CLIENT_URL || "https://jeenglish.com",
  methods: ["GET", "POST"],
}));
app.use(express.json());
app.use(fileUpload());
app.get("/", (req, res) => res.send("✅ JE Speaking Backend is running successfully!"));

// =============== 🧠 AI 口语评分 ===============
app.post("/api/speaking/grade", async (req, res) => {
  try {
    // 1️⃣ 检查音频
    if (!req.files?.audio) {
      return res.status(400).json({ error: "No audio file uploaded." });
    }
    const audioFile = req.files.audio;
    const tempPath = path.join("/tmp", audioFile.name);
    await audioFile.mv(tempPath);

    // 2️⃣ 获取前端 examples
    let examples = [];
    try {
      if (req.body.examples) examples = JSON.parse(req.body.examples);
    } catch (e) {
      console.warn("⚠️ Invalid examples JSON:", e.message);
    }

    // 3️⃣ 初始化 OpenAI
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    console.log("🎧 Received:", audioFile.name);
    if (examples.length) console.log("📘 Examples received:", examples.length);

    // 4️⃣ Whisper 转文字
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tempPath),
      model: "whisper-1",
      response_format: "text",
    });
    const text = transcription.trim();
    console.log("🗣 Transcribed:", text.slice(0, 100) + "...");

    // 5️⃣ GPT 对比反馈
    const prompt = `
You are an English speaking coach for intermediate (B1–B2) students.
Compare the student's 90-second speech with the teacher's 5 example sentences.

Teacher examples:
${examples.map((s, i) => `${i + 1}. ${s}`).join("\n")}

Student speech:
${text}

Please:
- Check how similar and clear the student’s sentences are.
- Give easy feedback in **simple English (A2–B1 level)**.
- Focus on 3 parts, each on a new line:
💬 Fluency — comment + 1 suggestion  
🧠 Vocabulary — comment + 1 simple reword  
🛠 Grammar — comment + 1 correction example (use 👉 and ✅)
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.4,
      messages: [
        { role: "system", content: "You are a kind and simple English coach." },
        { role: "user", content: prompt },
      ],
    });

    const feedback = completion.choices[0].message.content.trim();
    console.log("🧠 Feedback:", feedback);

    // 6️⃣ 返回结果（保持换行格式）
    res.json({
      fluency: feedback.match(/💬[\s\S]*?(?=🧠|$)/)?.[0]?.trim() || "No fluency feedback.",
      vocabulary: feedback.match(/🧠[\s\S]*?(?=🛠|$)/)?.[0]?.trim() || "No vocabulary feedback.",
      grammar: feedback.match(/🛠[\s\S]*$/)?.[0]?.trim() || "No grammar feedback.",
    });

    // 清理临时文件
    fs.unlink(tempPath, () => {});
  } catch (err) {
    console.error("❌ Error in /api/speaking/grade:", err);
    res.status(500).json({ error: err.message || "Internal server error." });
  }
});

// =============== 🚀 启动服务 ===============
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

