# 単語学習アプリ バックエンド

## 概要

このプロジェクトは単語学習アプリのバックエンドAPIを提供します。間隔反復学習法（Spaced Repetition）に基づいた学習アルゴリズムを実装し、効率的な語彙習得をサポートします。

## 機能

- 単語の登録・削除・一覧取得
- FSRSアルゴリズムに基づく間隔反復学習システム
- 学習進捗の追跡と統計情報の提供
- データのインポート/エクスポート機能

## 技術スタック

- Node.js
- Express.js
- LowDB (JSONファイルベースのデータベース)

## インストールと実行

```bash
##依存関係のインストール
npm install
##開発モードで実行
npm run dev
##本番モードで実行
npm start
```

## API エンドポイント

### 単語管理

- `GET /api/words` - 全ての単語を取得
- `POST /api/words` - 新しい単語を追加
- `DELETE /api/words/:id` - 指定したIDの単語を削除

### 学習機能

- `GET /api/study` - 学習すべき単語を取得
- `POST /api/words/:id/update` - 学習結果を更新

### 統計情報

- `GET /api/stats` - 学習統計を取得

### データ管理

- `GET /api/export` - 単語データをエクスポート
- `POST /api/import` - 単語データをインポート

## 学習アルゴリズム

このアプリはSM-2アルゴリズムをベースにした間隔反復システムを実装しています。単語の記憶強度に応じて次回の復習タイミングが自動的に調整されます。


## 注意事項

- データはローカルの`db.json`ファイルに保存されます
- 本番環境では適切なデータバックアップ戦略を検討してください