// server.js
const express = require('express');
const cors = require('cors');
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');
const path = require('path');
const math = require('mathjs');
const fs = require('fs');

const app = express();
const port = 3001;

const corsOptions = {
    origin: process.env.FRONTEND_URL || '*', // フロントエンドのURLを環境変数から取得
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
            stability: 1,
            difficulty: 4.93,
            retrievability: 0
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

// FSRSアルゴリズムに基づく間隔反復システムの実装
const calculateNextReview = (correct, confidence, word) => {
    // FSRSパラメータの初期化
    const now = Date.now();
    const lastReviewDate = word.lastStudiedAt || now;
    const elapsedDays = Math.max(1, (now - lastReviewDate) / (1000 * 60 * 60 * 24));

    // 初期値
    let stability = word.stability || 0.01; // 初回学習時の安定度をさらに低く設定
    let difficulty = word.difficulty || 4.93;
    const retrievability = Math.exp(Math.log(0.9) * elapsedDays / stability);

    // 初回学習の場合、5分後に復習
    if (!word.lastStudiedAt) {
        const nextReviewDate = now + 5 * 60 * 1000; // 現在時刻から5分後
        const retentionRate = 0.9;
        const initialGrade = confidence; // 初回のgradeはconfidenceを使用

        return {
            stability: 0.01, // 初回安定度を0.01に設定
            difficulty: 4.93,
            retrievability: 0,
            nextReviewDate,
            lastGrade: parseFloat(initialGrade.toFixed(2)),
            intervalDays: 5 / (60 * 24), // 5分を日数に変換
            retentionRate: 0.9 // 初回学習時の記憶保持率を固定
        };
    }

    // 2回目の学習の場合、5分後に復習
    if (word.totalReviews === 1) {
        const nextReviewDate = now + 5 * 60 * 1000; // 現在時刻から5分後
        const elapsedDays = 5 / (60 * 24); // 5分を日数に変換
        const retentionRate = Math.exp(Math.log(0.9) * elapsedDays / 0.1);
        const initialGrade = confidence; // 2回目のgradeはconfidenceを使用

        return {
            stability: 0.1, // 2回目安定度を0.1に設定
            difficulty: 4.93,
            retrievability: 0,
            nextReviewDate,
            lastGrade: parseFloat(initialGrade.toFixed(2)),
            intervalDays: 5 / (60 * 24), // 5分を日数に変換
            retentionRate: parseFloat(retentionRate.toFixed(2)) // 記憶保持率を小数点2桁に丸める
        };
    }

    // 評価スコア（0-1の範囲）
    const grade = correct ? Math.min(1, Math.max(0, confidence)) : 0;

    // FSRSパラメータ更新
    const deltaRecall = grade - retrievability;

    // 難易度の更新
    difficulty = Math.max(1, Math.min(10,
        difficulty + deltaRecall * (0.1 - difficulty * 0.02)
    ));

    // 安定度の更新
    const stabilityFactor = 1 + Math.exp(-difficulty) *
        (Math.pow(19, deltaRecall) - 1) *
        Math.pow(elapsedDays, -0.5);
    stability = Math.max(0.1, stability * stabilityFactor);

    // 次回復習間隔の計算
    console.log('FSRS Parameters:', {
        stability,
        difficulty,
        retrievability,
        elapsedDays,
        grade
    });

    const optimalFactor = Math.log(0.9) / Math.log(0.95);
    let intervalDays = stability * optimalFactor;
    console.log('Initial intervalDays:', intervalDays);

    // 間隔の調整（最小5分、最大365日）
    const clampedInterval = Math.max(5 / (60 * 24), Math.min(365, intervalDays));
    console.log('Clamped interval:', clampedInterval);

    // 次回復習日時を計算（分単位で丸める）
    const intervalMillis = clampedInterval * 24 * 60 * 60 * 1000;
    const nextReviewDate = Math.round((now + intervalMillis) / (1000 * 60)) * 1000 * 60;

    // 3回目以降の学習は通常のFSRSアルゴリズムに従う

    // 記憶保持率の計算
    const retentionRate = Math.exp(Math.log(0.9) * clampedInterval / stability);

    return {
        stability: parseFloat(stability.toFixed(2)),
        difficulty: parseFloat(difficulty.toFixed(2)),
        retrievability: parseFloat(retrievability.toFixed(2)),
        nextReviewDate,
        lastGrade: parseFloat(grade.toFixed(2)),
        intervalDays: parseFloat(clampedInterval.toFixed(2)),
        retentionRate: parseFloat(retentionRate.toFixed(2))
    };
};

// 学習対象の単語を返す API エンドポイント
app.get('/api/study', async (req, res) => {
    try {
        await db.read();
        const now = Date.now();

        // 復習すべき単語（次の復習日が現在以前、または未学習の単語）
        const dueWords = db.data.words.filter(word => {
            if (!word.nextReviewDate) return true;

            // 5分の猶予期間を設ける
            const dueTime = word.nextReviewDate - (5 * 60 * 1000);
            return dueTime <= now;
        });

        // 安定度の低い順にソート
        dueWords.sort((a, b) => {
            const stabilityA = a.stability || 1;
            const stabilityB = b.stability || 1;
            return stabilityA - stabilityB;
        });

        // 最大10単語まで返す
        const limitedWords = dueWords.slice(0, 10);

        res.json({
            words: limitedWords,
            currentTime: now,
            nextCheck: limitedWords.length > 0 ?
                Math.min(...limitedWords.map(w => w.nextReviewDate || now)) :
                now + (5 * 60 * 1000) // 5分後に再チェック
        });
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

        // FSRSアルゴリズムによる次回復習日の計算
        const {
            stability,
            difficulty,
            retrievability,
            nextReviewDate,
            lastGrade
        } = calculateNextReview(correct, confidence, word);

        // レベル更新ロジック
        let newLevel = word.level || 1;
        // 正解かつ自信度が0.5以上、またはstabilityが0.5以上の場合にレベルアップ
        if ((correct && confidence >= 0.5) || stability >= 0.5) {
            if (newLevel < 8) {
                newLevel++;
            }
        }

        // 単語データの更新
        db.data.words[wordIndex] = {
            ...word,
            lastStudiedAt: Date.now(),
            totalReviews,
            successCount,
            stability,
            difficulty,
            retrievability,
            nextReviewDate,
            lastGrade,
            level: newLevel
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
                            stability: word.stability || 1,
                            difficulty: word.difficulty || 4.93,
                            retrievability: word.retrievability || 0,
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
