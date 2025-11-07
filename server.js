import express from "express";
import cors from "cors";
import fileUpload from "express-fileupload";
import dotenv from "dotenv";
import { OpenAI } from "openai";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;

// 中间件
app.use(cors({
  origin: process.env.CLIENT_URL || "*", // ← 生产环境可改成 https://jeenglish.com
  methods: ["GET", "POST"],
}));
app.use(express.json());
app.use(fileUpload());

// 测试路由（可在浏览器直接访问确认服务是否启动）
app.get("/", (req, res) => {
  res.send("✅ JE Speaking Backend is running successfully!");
});

// 关键接口：AI 口语评分
app.post("/api/speaking/grade", async (req, res) => {
  try {
    const audioFile = req.files?.audio;
    if (!audioFile) {
      return res.status(400).json({ error: "No audio file uploaded." });
    }

    // 初始化 OpenAI
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    // Step 1️⃣: Whisper 语音转文字
    const transcription = await openai.audio.transcriptions.create({
      model: "whisper-1",
      file: audioFile.data,
    });

    const text = transcription.text;
    console.log("🎧 Transcribed text:", text);

    // Step 2️⃣: 调用 GPT 分析语言质量
    const feedbackPrompt = `
You are an English speaking test coach.
Analyze the student's spoken response below and give feedback in three parts:

1. Fluency (how smooth and natural the speaking is)
2. Vocabulary (word choice and variety)
3. Grammar (errors and improvements)

Return the feedback in concise English sentences.

Response:
${text}
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a helpful English speaking evaluator." },
        { role: "user", content: feedbackPrompt },
      ],
    });

    const result = completion.choices[0].message.content || "";

    // 将结果拆成三段（粗略分割）
    const [fluency, vocabulary, grammar] = result.split(/\n\s*\n/);

    res.json({
      fluency: fluency || "No fluency feedback.",
      vocabulary: vocabulary || "No vocabulary feedback.",
      grammar: grammar || "No grammar feedback.",
    });

  } catch (err) {
    console.error("❌ Error generating feedback:", err);
    res.status(500).json({ error: err.message || "Internal server error." });
  }
});

// 启动服务
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});
