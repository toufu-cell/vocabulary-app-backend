// server.js
const express = require('express');
const cors = require('cors');
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');
const path = require('path');

const app = express();
const port = 3001;

// CORSの設定を更新
const corsOptions = {
    origin: '*', // すべてのオリジンを許可（開発環境のみ）
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
    optionsSuccessStatus: 204
};

app.use(cors(corsOptions));
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

// SM-2アルゴリズムに基づく間隔反復システムの実装
const calculateNextReview = (correct, confidence, word) => {
    // 現在の記憶強度（初期値は0）
    let memoryStrength = word.memoryStrength || 0;

    // 現在の復習間隔（初期値は1日）
    let interval = word.interval || 1;

    // 現在の容易度係数（初期値は2.5）
    let easeFactor = word.easeFactor || 2.5;

    // 自己評価スコアの計算（0-5のスケール）
    // 正解かつ高い自信 = 5, 正解かつ低い自信 = 4, 不正解かつ高い自信 = 2, 不正解かつ低い自信 = 1
    let grade;
    if (correct) {
        grade = confidence >= 0.7 ? 5 : 4;
    } else {
        grade = confidence >= 0.3 ? 2 : 1;
    }

    if (grade >= 3) {
        // 正解の場合
        if (memoryStrength === 0) {
            // 初めて正解した場合
            interval = 1;
        } else if (memoryStrength === 1) {
            // 2回目の正解
            interval = 6;
        } else {
            // それ以降の正解
            interval = Math.round(interval * easeFactor);
        }
        memoryStrength += 1;
    } else {
        // 不正解の場合
        memoryStrength = Math.max(0, memoryStrength - 1);
        interval = 1; // 間隔をリセット
    }

    // 容易度係数の更新（最小値は1.3）
    easeFactor = Math.max(1.3, easeFactor + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02)));

    // 次の復習日を計算
    const now = Date.now();
    const nextReviewDate = now + interval * 24 * 60 * 60 * 1000;

    return {
        memoryStrength,
        interval,
        easeFactor,
        nextReviewDate,
        lastGrade: grade
    };
};

// 学習対象の単語を返す API エンドポイント
app.get('/api/study', async (req, res) => {
    try {
        await db.read();
        const now = Date.now();

        // 復習すべき単語（次の復習日が現在以前、または未学習の単語）
        const dueWords = db.data.words.filter(word =>
            !word.nextReviewDate || word.nextReviewDate <= now
        );

        // 記憶強度の低い順にソート
        dueWords.sort((a, b) => {
            const strengthA = a.memoryStrength || 0;
            const strengthB = b.memoryStrength || 0;
            return strengthA - strengthB;
        });

        res.json(dueWords);
    } catch (error) {
        console.error('学習単語の取得に失敗しました', error);
        res.status(500).json({ error: '学習単語の取得に失敗しました' });
    }
});

// 単語の学習結果を更新する API エンドポイントを改善
app.post('/api/words/:id/update', async (req, res) => {
    const { id } = req.params;
    const { correct, confidence } = req.body;

    try {
        await db.read();
        const wordIndex = db.data.words.findIndex(w => w.id == id);

        if (wordIndex === -1) {
            return res.status(404).json({ error: '単語が見つかりません' });
        }

        const word = db.data.words[wordIndex];

        // 学習データの更新
        const totalReviews = (word.totalReviews || 0) + 1;
        const successCount = (word.successCount || 0) + (correct ? 1 : 0);

        // SM-2アルゴリズムによる次回復習日の計算
        const {
            memoryStrength,
            interval,
            easeFactor,
            nextReviewDate,
            lastGrade
        } = calculateNextReview(correct, confidence, word);

        // 単語データの更新
        db.data.words[wordIndex] = {
            ...word,
            lastStudiedAt: Date.now(),
            totalReviews,
            successCount,
            memoryStrength,
            interval,
            easeFactor,
            nextReviewDate,
            lastGrade
        };

        await db.write();

        res.json({
            success: true,
            word: db.data.words[wordIndex],
            nextReviewDate: new Date(nextReviewDate).toLocaleString('ja-JP')
        });
    } catch (error) {
        console.error('単語の更新に失敗しました', error);
        res.status(500).json({ error: '単語の更新に失敗しました' });
    }
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

// 単語を削除するAPIエンドポイント
app.delete('/api/words/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
        return res.status(400).json({ message: "無効なIDです" });
    }

    await db.read();
    const words = db.data.words;
    const wordIndex = words.findIndex(w => w.id === id);

    if (wordIndex === -1) {
        return res.status(404).json({ message: "単語が見つかりません" });
    }

    const deletedWord = words[wordIndex];
    db.data.words.splice(wordIndex, 1);
    await db.write();

    res.json({ message: `単語 "${deletedWord.word}" を削除しました`, deletedWord });
});

// 全ての単語を取得するAPIエンドポイント
app.get('/api/words', async (req, res) => {
    await db.read();
    res.json(db.data.words);
});

// 学習統計を取得するAPIエンドポイント
app.get('/api/stats', async (req, res) => {
    await db.read();
    const words = db.data.words;

    // 現在の日付
    const now = Date.now();

    // 習得済み単語（記憶強度6以上）
    const learnedWords = words.filter(word => (word.memoryStrength || 0) >= 6).length;

    // 今日復習すべき単語
    const reviewsDue = words.filter(word => {
        return !word.nextReviewDate || word.nextReviewDate <= now;
    }).length;

    // 平均正答率の計算
    let totalReviews = 0;
    let totalSuccess = 0;

    words.forEach(word => {
        const successCount = word.successCount || 0;
        const totalCount = (word.totalReviews || 0);

        totalSuccess += successCount;
        totalReviews += totalCount;
    });

    const averageAccuracy = totalReviews > 0 ? Math.round((totalSuccess / totalReviews) * 100) : 0;

    // 過去7日間の学習データ
    const dailyProgress = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 6; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dateStr = date.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' });

        const dayStart = date.getTime();
        const dayEnd = dayStart + 24 * 60 * 60 * 1000 - 1;

        const reviewCount = words.filter(word => {
            return word.lastStudiedAt && word.lastStudiedAt >= dayStart && word.lastStudiedAt <= dayEnd;
        }).length;

        dailyProgress.push({ date: dateStr, reviewCount });
    }

    res.json({
        totalWords: words.length,
        learnedWords,
        reviewsDue,
        averageAccuracy,
        dailyProgress
    });
});

// データをエクスポートするAPIエンドポイント
app.get('/api/export', async (req, res) => {
    try {
        await db.read();

        // 単語データをJSON形式で返す
        const exportData = {
            words: db.data.words,
            exportDate: new Date().toISOString(),
            version: '1.0'
        };

        // Content-Dispositionヘッダーを設定してダウンロードファイル名を指定
        res.setHeader('Content-Disposition', 'attachment; filename=vocabulary-data.json');
        res.setHeader('Content-Type', 'application/json');
        res.json(exportData);
    } catch (error) {
        console.error('データのエクスポートに失敗しました', error);
        res.status(500).json({ error: 'データのエクスポートに失敗しました' });
    }
});

// データをインポートするAPIエンドポイント
app.post('/api/import', async (req, res) => {
    try {
        const importData = req.body;

        // データの検証
        if (!importData || !importData.words || !Array.isArray(importData.words)) {
            return res.status(400).json({ error: '無効なデータ形式です' });
        }

        await db.read();

        // インポートする単語の検証と処理
        const currentWords = db.data.words;
        const currentWordMap = new Map(currentWords.map(w => [w.word.toLowerCase(), w]));

        let added = 0;
        let updated = 0;
        let skipped = 0;

        // 新しいIDを生成するための最大ID取得
        let maxId = currentWords.length > 0 ? Math.max(...currentWords.map(w => w.id)) : 0;

        for (const word of importData.words) {
            // 必須フィールドの検証
            if (!word.word || !word.meaning) {
                skipped++;
                continue;
            }

            const lowerWord = word.word.toLowerCase();

            if (currentWordMap.has(lowerWord)) {
                // 既存の単語の場合は更新（オプション）
                const existingWord = currentWordMap.get(lowerWord);

                // 既存の単語を更新するかどうかのフラグ（リクエストパラメータから取得）
                if (req.query.updateExisting === 'true') {
                    const index = currentWords.findIndex(w => w.id === existingWord.id);

                    // 既存の単語を更新（IDと作成日は保持）
                    currentWords[index] = {
                        ...existingWord,
                        meaning: word.meaning,
                        // 学習データは保持するか更新するかを選択可能
                        ...(req.query.keepProgress !== 'true' && {
                            level: word.level || 1,
                            memoryStrength: word.memoryStrength || 0,
                            interval: word.interval || 1,
                            easeFactor: word.easeFactor || 2.5,
                            totalReviews: word.totalReviews || 0,
                            successCount: word.successCount || 0
                        })
                    };
                    updated++;
                } else {
                    skipped++;
                }
            } else {
                // 新しい単語の場合は追加
                maxId++;
                currentWords.push({
                    id: maxId,
                    word: word.word,
                    meaning: word.meaning,
                    level: word.level || 1,
                    lastStudiedAt: word.lastStudiedAt || null,
                    createdAt: Date.now(),
                    memoryStrength: word.memoryStrength || 0,
                    interval: word.interval || 1,
                    easeFactor: word.easeFactor || 2.5,
                    totalReviews: word.totalReviews || 0,
                    successCount: word.successCount || 0,
                    nextReviewDate: word.nextReviewDate || null
                });
                added++;
            }
        }

        // データベースに保存
        await db.write();

        res.json({
            success: true,
            message: `インポート完了: ${added}件追加、${updated}件更新、${skipped}件スキップ`,
            added,
            updated,
            skipped
        });
    } catch (error) {
        console.error('データのインポートに失敗しました', error);
        res.status(500).json({ error: 'データのインポートに失敗しました' });
    }
});

// ルートパスへのアクセスをフロントエンドにリダイレクト
app.get('/', (req, res) => {
    // フロントエンドのURLにリダイレクト
    const frontendUrl = process.env.FRONTEND_URL || 'http://192.168.0.9:3000';
    res.redirect(frontendUrl);
});

app.listen(port, '0.0.0.0', () => {
    console.log(`サーバーがポート ${port} で起動しました`);
});
