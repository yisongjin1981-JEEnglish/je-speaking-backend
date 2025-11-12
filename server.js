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

// ==============================
// 🌐 基础中间件
// ==============================
app.use(cors({
  origin: process.env.CLIENT_URL || "https://jeenglish.com",
  methods: ["GET", "POST"],
}));
app.use(express.json());
app.use(fileUpload());

// ==============================
// 🧭 测试路由
// ==============================
app.get("/", (req, res) => {
  res.send("✅ JE Speaking Backend is running successfully!");
});

// ==============================
// 🧠 AI 口语评分路由
// ==============================
app.post("/api/speaking/grade", async (req, res) => {
  try {
    // 🗂️ 检查上传文件
    if (!req.files || !req.files.audio) {
      return res.status(400).json({ error: "No audio file uploaded." });
    }

    const audioFile = req.files.audio;
    const tempPath = path.join("/tmp", audioFile.name);
    await audioFile.mv(tempPath); // ✅ 写入 Render 临时目录

    // 🧠 初始化 OpenAI 客户端
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    console.log("🎧 Received audio:", audioFile.name);

    // Step 1️⃣: Whisper 语音转文字
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tempPath),
      model: "whisper-1",
      response_format: "text",
    });

    console.log("🗣 Transcribed text:", transcription);

    // Step 2️⃣: GPT 语言分析
   const prompt = `
You are an English speaking coach for B1–B2 students.

Below are 5 example sentences from the lesson. 
The student just gave a 90-second response based on these examples.

Examples:
${examples.map((s, i) => `${i + 1}. ${s}`).join("\n")}

Student's 90s response:
${text}

Please:
1. Understand the main ideas in the examples (content & structure).
2. Check if the student’s speech follows the same ideas and is clear.
3. Give short, easy-to-understand feedback for each part:
   💬 Fluency — Is the speech smooth and easy to follow?
   🧠 Vocabulary — Are the words natural and similar to the examples?
   🛠 Grammar — Any small mistakes? Show one correction if possible.

Use simple English (A2–B1 level), and give at least one concrete suggestion 
like this:

💬 Fluency: Good flow! Try to speak a little slower.
🧠 Vocabulary: Nice! You can also say “...” instead of “...”.
🛠 Grammar: Almost perfect! 👉 Instead of “He go”, ✅ Say “He goes”.
`;


    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a helpful English teacher." },
        { role: "user", content: prompt },
      ],
      temperature: 0.4,
    });

    const raw = completion.choices[0].message.content.trim();
    console.log("🧠 Raw feedback:", raw);

    // Step 3️⃣: 安全 JSON 解析
    let feedback;
    try {
      feedback = JSON.parse(raw);
    } catch (e) {
      feedback = {
        fluency: raw,
        vocabulary: "Feedback format unclear.",
        grammar: "Feedback format unclear.",
      };
    }

    // Step 4️⃣: 返回前端
    res.json({
      fluency: feedback.fluency || "No fluency feedback.",
      vocabulary: feedback.vocabulary || "No vocabulary feedback.",
      grammar: feedback.grammar || "No grammar feedback.",
    });

    // ✅ 删除临时文件
    fs.unlink(tempPath, () => {});
  } catch (err) {
    console.error("❌ Error in /api/speaking/grade:", err);
    res.status(500).json({ error: err.message || "Internal server error." });
  }
});

// ==============================
// 🚀 启动服务
// ==============================
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});
