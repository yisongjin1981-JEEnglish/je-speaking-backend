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
// 🗂️ 从 JSONBin 云端读取 usage.json（强制不缓存 & 兼容 record）
// ==============================
async function readUsage() {
  try {
    const res = await axios.get(`${JSONBIN_URL}/latest?${Date.now()}`, {
      headers: {
        "X-Master-Key": JSONBIN_KEY,
        "X-Bin-Meta": "false",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
      },
    });

    // 🧩 兼容 JSONBin 的两种返回格式
    let data;

    if (res.data?.record) {
      // 你终端看到的就是这种格式
      data = res.data.record;
    } else {
      // 万一是旧格式
      data = res.data;
    }

    console.log("📥 Read usage from JSONBin:", JSON.stringify(data, null, 2));

    return data || {};

  } catch (err) {
    console.warn("⚠️ Failed to read JSONBin:", err.response?.status, err.message);
    return {};
  }
}




// ✅ 写回 usage.json 到云端（不使用 /latest）
async function writeUsage(data) {
  try {
    console.log("📤 Uploading usage data to JSONBin...");
    const putRes = await axios.put(JSONBIN_URL, data, {
      headers: {
        "Content-Type": "application/json",
        "X-Master-Key": JSONBIN_KEY,
        "X-Bin-Meta": "false",
      },
    });
    if (putRes.status === 200) {
      console.log("✅ JSONBin updated successfully.");
    } else {
      console.warn(`⚠️ JSONBin responded with status ${putRes.status}`);
    }
  } catch (err) {
    console.error("❌ Failed to update JSONBin:", err.response?.data || err.message);
  }
}
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

Please analyze the student's speech **by comparing it with the example sentences above**, and give detailed yet easy-to-understand feedback.

Your feedback must include **three labeled sections**, written in friendly classroom tone (A2–B1 English).  
Keep it clear, short paragraphs (2–3 sentences per part), not bullet points.

💬 **Fluency**
- Compare the student's fluency with the tone and rhythm of the examples.  
- Mention if the student speaks smoothly, too slowly, or hesitates.  
- Suggest 1–2 ways to improve flow, intonation, or linking words.

🧠 **Vocabulary**
- Compare the student's word choice with the example sentences.  
- Point out if they repeated simple words or missed useful expressions.  
- Suggest 2–3 natural replacements or collocations (use 👉 and ✅).

🛠 **Grammar & Structure**
- Compare the student's grammar accuracy and sentence structure with the examples.  
- Highlight common mistakes (tense, article, preposition, etc.) with corrections.  
- End with one short tip for improvement, like “Practice using present continuous.”

At the end, finish with one encouraging sentence, such as:
✨ “You’re improving fast — keep practicing with the examples!” ✨
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a kind English teacher." },
        { role: "user", content: feedbackPrompt },
      ],
      temperature: 0.5,
    });

    const feedbackText = completion.choices[0].message.content.trim();
    console.log("🧠 Full Feedback Text:\n", feedbackText);

    // === Step 2.5️⃣ 解析三项反馈 ===
    const fluencyMatch = feedbackText.match(/Fluency[:：]?\s*([\s\S]*?)(?=🧠|Vocabulary|$)/i);
    const vocabMatch = feedbackText.match(/Vocabulary[:：]?\s*([\s\S]*?)(?=🛠|Grammar|$)/i);
    const grammarMatch = feedbackText.match(/Grammar[:：]?\s*([\s\S]*)/i);

    const fluencyFeedback = fluencyMatch ? fluencyMatch[1].trim() : "";
    const vocabularyFeedback = vocabMatch ? vocabMatch[1].trim() : "";
    const grammarFeedback = grammarMatch ? grammarMatch[1].trim() : "";

    // === Step 3️⃣ 更新用量 ===
    userUsage.used++;

    // ✅ 写回 JSONBin
    await writeUsage(usageData);

    // ✅ 返回前端
    res.json({
      fluency: fluencyFeedback,
      vocabulary: vocabularyFeedback,
      grammar: grammarFeedback,
      used: userUsage.used,
      limit: userUsage.limit,
      remaining: userUsage.limit - userUsage.used,
      updated: true,
    });

    // 🧹 清理临时文件
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
