// server.js
const express = require('express');
const cors = require('cors');
const app = express();
const port = 3001;

app.use(cors());
app.use(express.json());

// サンプルの単語データベース（in-memory）
let words = [
    { id: 1, word: "cat", meaning: "猫", level: 1, lastStudiedAt: null },
    { id: 2, word: "dog", meaning: "犬", level: 1, lastStudiedAt: null },
    { id: 3, word: "apple", meaning: "りんご", level: 1, lastStudiedAt: null },
    // 必要に応じて追加...
];

// 各レベルに応じた復習間隔（ミリ秒）
const levelIntervals = {
    1: 1 * 60 * 1000,    // 1分
    2: 5 * 60 * 1000,    // 5分
    3: 10 * 60 * 1000,   // 10分
    4: 60 * 60 * 1000,   // 1時間
    5: 24 * 60 * 60 * 1000  // 1日
};

// 単語が復習対象かどうかを判定する関数
function isDue(word) {
    // 未学習の場合は常に対象
    if (!word.lastStudiedAt) return true;
    const interval = levelIntervals[word.level] || levelIntervals[1];
    return (Date.now() - word.lastStudiedAt) >= interval;
}

// 学習対象の単語を返す API エンドポイント
app.get('/api/study', (req, res) => {
    const studyWords = words.filter(word => isDue(word));
    res.json(studyWords);
});

// 単語の学習結果を更新する API エンドポイント
app.post('/api/words/:id/update', (req, res) => {
    const { id } = req.params;
    const { correct } = req.body; // 正解か否かのフラグ（boolean）
    let word = words.find(w => w.id == id);
    if (!word) {
        return res.status(404).json({ message: "単語が見つかりません" });
    }
    // 正解ならレベルアップ（最大 5 まで）、不正解ならレベルをリセット
    if (correct) {
        if (word.level < 5) {
            word.level += 1;
        }
    } else {
        word.level = 1;
    }
    // 最終学習日時を更新
    word.lastStudiedAt = Date.now();
    res.json(word);
});

// ★ 新規追加：単語を登録する API エンドポイント
app.post('/api/words', (req, res) => {
    const { word, meaning } = req.body;
    if (!word || !meaning) {
        return res.status(400).json({ message: "単語と意味の両方を入力してください" });
    }
    // 新しい id を生成（配列内の最大 id + 1）
    const newId = words.length > 0 ? Math.max(...words.map(w => w.id)) + 1 : 1;
    const newWord = { id: newId, word, meaning, level: 1, lastStudiedAt: null };
    words.push(newWord);
    res.status(201).json(newWord);
});

app.listen(port, () => {
    console.log(`サーバーがポート ${port} で起動しました`);
});
