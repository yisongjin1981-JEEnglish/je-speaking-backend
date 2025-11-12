import express from "express";
import cors from "cors";
import fileUpload from "express-fileupload";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import axios from "axios";
import { OpenAI } from "openai";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ==============================
// 🌐 基础设置
// ==============================
app.use(cors({
  origin: process.env.CLIENT_URL || "https://jeenglish.com",
  methods: ["GET", "POST"],
}));
app.use(express.json());
app.use(fileUpload());

// ==============================
// 🗂️ JSONBin 云存储配置
// ==============================
const JSONBIN_URL = process.env.JSONBIN_URL;
const JSONBIN_KEY = process.env.JSONBIN_KEY;

// 读取 usage.json
async function readUsage() {
  try {
    const res = await axios.get(JSONBIN_URL, {
      headers: { "X-Master-Key": JSONBIN_KEY },
    });
    return res.data?.record || {};
  } catch (err) {
    console.warn("⚠️ usage.json not found, creating new one...");
    return {};
  }
}

// 写回 usage.json
async function writeUsage(data) {
  await axios.put(JSONBIN_URL, data, {
    headers: {
      "Content-Type": "application/json",
      "X-Master-Key": JSONBIN_KEY,
    },
  });
}

// ==============================
// 🧭 测试路由
// ==============================
app.get("/", (req, res) => {
  res.send("✅ JE Speaking Backend (Persistent) is running successfully!");
});

// ==============================
// 📊 查询用户使用次数
// ==============================
app.get("/api/usage/:email", async (req, res) => {
  try {
    const email = req.params.email.toLowerCase();
    const monthKey = new Date().toISOString().slice(0, 7);

    const usageData = await readUsage();
    const userUsage = usageData[email]?.[monthKey] || { used: 0, limit: 30 };

    res.json(userUsage);
  } catch (err) {
    console.error("❌ Error reading usage:", err);
    res.status(500).json({ error: "Failed to fetch usage data." });
  }
});

// ==============================
// 🧠 口语评分接口
// ==============================
app.post("/api/speaking/grade", async (req, res) => {
  try {
    // === 参数解析 ===
    const { files, body } = req;
    const audioFile = files?.audio;
    const userEmail = body?.userEmail?.toLowerCase() || "anonymous@example.com";
    const examples = JSON.parse(body?.examples || "[]");

    // === 使用次数控制 ===
    const monthKey = new Date().toISOString().slice(0, 7);
    const usageData = await readUsage();

    if (!usageData[userEmail]) usageData[userEmail] = {};
    if (!usageData[userEmail][monthKey]) usageData[userEmail][monthKey] = { used: 0, limit: 30 };

    const userUsage = usageData[userEmail][monthKey];
    if (userUsage.used >= userUsage.limit) {
      return res.status(403).json({ error: "Monthly limit reached (30 feedbacks)." });
    }

    // === 临时文件保存 ===
    const tempPath = path.join("/tmp", audioFile.name);
    await audioFile.mv(tempPath);
    console.log(`🎧 Received audio from ${userEmail}: ${audioFile.name}`);

    // === Step 1️⃣ Whisper 转文字 ===
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tempPath),
      model: "whisper-1",
      response_format: "text",
    });
    const text = transcription.trim();
    console.log("🗣 Transcribed text:", text);

    // === Step 2️⃣ GPT 反馈生成 ===
    const feedbackPrompt = `
You are an English speaking coach for B1–B2 students.
Below are 5 example sentences from the lesson.
The student just gave a 90-second response based on these examples.

Examples:
${examples.map((s, i) => `${i + 1}. ${s}`).join("\n")}

Student's 90s response:
${text}

Please:
- Give feedback in **simple English (A2–B1 level)**.
- Focus on 3 short parts:

💬 Fluency — comment + 1 suggestion  
🧠 Vocabulary — comment + 1 simple reword  
🛠 Grammar — comment + 1 correction (use 👉 and ✅)
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a kind English teacher." },
        { role: "user", content: feedbackPrompt },
      ],
      temperature: 0.5,
    });

    const feedback = completion.choices[0].message.content.trim();
    console.log("🧠 Feedback:", feedback);

 // === Step 3️⃣ 更新用量 ===
userUsage.used++;

// ✅ 先返回给前端（只发一次）
res.json({
  feedback,
  used: userUsage.used,
  limit: userUsage.limit,
  remaining: userUsage.limit - userUsage.used,
});

// 异步执行后续逻辑，不再 return 或再发响应
writeUsage(usageData)
  .then(() => console.log("✅ Usage updated in JSONBin"))
  .catch(err => console.error("❌ Failed to update usage:", err));

fs.unlink(tempPath, () => {});

    // 删除临时文件
    fs.unlink(tempPath, () => {});
  } catch (err) {
    console.error("❌ Error in /api/speaking/grade:", err);
    res.status(500).json({ error: "Server error during speech grading." });
  }
});

// ==============================
// 🚀 启动服务
// ==============================
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
