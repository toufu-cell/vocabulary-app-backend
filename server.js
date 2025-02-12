// server.js
const express = require('express');
const cors = require('cors');
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');
const path = require('path');

const app = express();
const port = 3001;

app.use(cors());
app.use(express.json());

const defaultData = {
    words: [
        {
            id: 1,
            word: "example",
            meaning: "例",
            level: 1,
            lastStudiedAt: null,
            createdAt: Date.now(),
            successCount: 0,
            failureCount: 0,
            totalReviews: 0,
            memoryStrength: 0
        }
    ]
};

const file = path.join(__dirname, 'db.json');
const adapter = new JSONFile(file);
const db = new Low(adapter, defaultData);  // デフォルトデータを第2引数として渡す

// initDB関数を修正
async function initDB() {
    await db.read();
    await db.write();  // 初期データがない場合は書き込む
}
initDB();

// 記憶の定着度に応じた復習間隔（ミリ秒）
const levelIntervals = {
    1: 5 * 60 * 1000,      // 5分（初回学習）
    2: 30 * 60 * 1000,     // 30分
    3: 12 * 60 * 60 * 1000,  // 12時間
    4: 24 * 60 * 60 * 1000,  // 1日
    5: 72 * 60 * 60 * 1000,  // 3日
    6: 7 * 24 * 60 * 60 * 1000,  // 1週間
    7: 14 * 24 * 60 * 60 * 1000, // 2週間
    8: 30 * 24 * 60 * 60 * 1000  // 1ヶ月
};

// 単語が復習対象かどうかを判定する関数
function isDue(word) {
    // 未学習の場合は常に対象
    if (!word.lastStudiedAt) return true;
    const interval = levelIntervals[word.level] || levelIntervals[1];
    return (Date.now() - word.lastStudiedAt) >= interval;
}

// 学習対象の単語を返す API エンドポイント
app.get('/api/study', async (req, res) => {
    await db.read();
    const words = db.data.words;
    const studyWords = words.filter(word => isDue(word));
    res.json(studyWords);
});

// 単語の学習結果を更新する API エンドポイント
app.post('/api/words/:id/update', async (req, res) => {
    const { id } = req.params;
    const { correct } = req.body;
    await db.read();
    let word = db.data.words.find(w => w.id == id);
    if (!word) {
        return res.status(404).json({ message: "単語が見つかりません" });
    }

    word.totalReviews = (word.totalReviews || 0) + 1;

    if (correct) {
        if (word.level < 5) {
            word.level += 1;
        }
    } else {
        word.level = 1;
    }

    word.lastStudiedAt = Date.now();
    await db.write();
    res.json(word);
});

// ★ 新規追加：単語を登録する API エンドポイント
app.post('/api/words', async (req, res) => {
    const { word, meaning } = req.body;
    if (!word || !meaning) {
        return res.status(400).json({ message: "単語と意味の両方を入力してください" });
    }

    await db.read();
    const words = db.data.words;

    // 重複チェック
    const existingWord = words.find(w => w.word.toLowerCase() === word.toLowerCase());
    if (existingWord) {
        return res.status(409).json({ message: "この単語は既に登録されています" });
    }

    const newId = words.length > 0 ? Math.max(...words.map(w => w.id)) + 1 : 1;
    const newWord = {
        id: newId,
        word,
        meaning,
        level: 1,
        lastStudiedAt: null,
        totalReviews: 0
    };
    db.data.words.push(newWord);
    await db.write();
    res.status(201).json(newWord);
});

app.listen(port, () => {
    console.log(`サーバーがポート ${port} で起動しました`);
});
