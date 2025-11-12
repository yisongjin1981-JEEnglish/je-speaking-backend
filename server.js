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
// 💾 使用次数记录系统（方案 A）
// ==============================
const usageFile = "/tmp/usage.json";

function loadUsage() {
  if (!fs.existsSync(usageFile)) return {};
  return JSON.parse(fs.readFileSync(usageFile, "utf8"));
}

function saveUsage(data) {
  fs.writeFileSync(usageFile, JSON.stringify(data, null, 2));
}

// ==============================
// 🧠 AI 口语评分路由
// ==============================
app.post("/api/speaking/grade", async (req, res) => {
  try {
    // 🧩 获取用户身份（前端需传 userEmail）
    const email = req.body.userEmail || "guest@example.com";
    const today = new Date();
    const monthKey = `${today.getFullYear()}-${today.getMonth() + 1}`;

    const usage = loadUsage();
    if (!usage[email]) usage[email] = {};
    if (!usage[email][monthKey]) usage[email][monthKey] = 0;

    // 每月最多 30 次
    if (usage[email][monthKey] >= 30) {
      return res.status(403).json({
        error: "❗ Your monthly feedback limit (30) has been reached. Please upgrade your plan or wait for next month.",
      });
    }

    // ✅ 增加计数
    usage[email][monthKey]++;
    saveUsage(usage);
    console.log(`📊 ${email} used feedback ${usage[email][monthKey]} times in ${monthKey}`);

    // 🗂️ 检查上传文件
    if (!req.files || !req.files.audio) {
      return res.status(400).json({ error: "No audio file uploaded." });
    }

    const audioFile = req.files.audio;
    const examples = req.body.examples ? JSON.parse(req.body.examples) : [];
    const tempPath = path.join("/tmp", audioFile.name);
    await audioFile.mv(tempPath);

    // 🧠 初始化 OpenAI
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    console.log("🎧 Received audio:", audioFile.name);

    // Step 1️⃣ Whisper 语音转文字
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tempPath),
      model: "whisper-1",
      response_format: "text",
    });

    const text = transcription.trim();
    console.log("🗣 Transcribed text:", text);

    // Step 2️⃣ GPT 反馈生成
    const prompt = `
You are an English speaking coach for B1–B2 students.

Below are 5 example sentences from the lesson.
The student gave a 90-second response based on these examples.

Examples:
${examples.map((s, i) => `${i + 1}. ${s}`).join("\n")}

Student's response:
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
        { role: "system", content: "You are a friendly English speaking coach." },
        { role: "user", content: prompt },
      ],
    });

    const feedbackText = completion.choices[0].message.content.trim();
    console.log("🧠 AI Feedback:", feedbackText);

    // Step 3️⃣ 格式化输出
    const extract = (label) => {
      const regex = new RegExp(`${label}:\\s*([^💬🧠🛠]*)`, "i");
      const match = feedbackText.match(regex);
      return match ? match[1].trim() : "";
    };

    res.json({
      fluency: extract("💬 Fluency") || feedbackText,
      vocabulary: extract("🧠 Vocabulary") || "",
      grammar: extract("🛠 Grammar") || "",
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

