import express from "express";
import multer from "multer";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import fs from "fs";

dotenv.config();
const app = express();
const upload = multer({ dest: "uploads/" });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// 允许跨域（改成你的网站域名）
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || "*" }));
app.use(express.json());

// 测试路由
app.get("/", (req, res) => {
  res.send("✅ JE Speaking Backend is running!");
});

// 主功能：接收录音 → Whisper 转文字 → GPT 分析反馈
app.post("/api/speaking/grade", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No audio file uploaded" });

    const audioPath = req.file.path;

    // Whisper 转文字
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(audioPath),
      model: "whisper-1"
    });

    const text = transcription.text || "";

    // GPT 分析口语反馈
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are an English speaking coach. Analyze the student's spoken English and give short, clear feedback on fluency, vocabulary, and grammar."
        },
        {
          role: "user",
          content: `Here is the student's speech transcript:\n\n${text}`
        }
      ],
      temperature: 0.6
    });

    const feedback = completion.choices[0].message.content;

    // 删除临时文件
    fs.unlink(audioPath, () => {});

    // 将反馈分成3部分
    const parsed = {
      fluency: feedback.match(/fluency[:：](.*)/i)?.[1]?.trim() || feedback,
      vocabulary: feedback.match(/vocabulary[:：](.*)/i)?.[1]?.trim() || "",
      grammar: feedback.match(/grammar[:：](.*)/i)?.[1]?.trim() || ""
    };

    res.json(parsed);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 JE Speaking Backend running on port ${PORT}`));
