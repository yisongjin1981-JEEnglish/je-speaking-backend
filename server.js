import express from "express";
import cors from "cors";
import multer from "multer";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// 初始化 OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// 测试路由
app.get("/", (req, res) => {
  res.send("JE Speaking Backend is running ✅");
});

// 示例接口：AI 反馈
app.post("/api/speaking-feedback", async (req, res) => {
  try {
    const { transcript } = req.body;
    const prompt = `Please provide concise English speaking feedback for: "${transcript}"`;
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
    });
    res.json({ feedback: completion.choices[0].message.content });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Failed to process feedback" });
  }
});

// Render 要求必须监听 PORT 环境变量
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
