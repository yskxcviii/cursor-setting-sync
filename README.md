# Cursor Settings Sync

Cursor の `settings.json` を複数デバイス間で同期するためのリポジトリです。

## 仕組み

- リポジトリ内の `settings.json` を Cursor の設定ディレクトリにシンボリックリンクとして配置します
- 1時間ごとに `main` ブランチを自動で pull し、最新の設定を反映します
- Mac と Windows の両方に対応しています

## 前提条件

- [Node.js](https://nodejs.org/) (v16 以上)
- [Git](https://git-scm.com/)
- Windows の場合: 開発者モードが有効であること (シンボリックリンク作成に必要)

## セットアップ

```bash
git clone <repository-url>
cd cursor-settings
```

## 使い方

### 同期を有効化する

```bash
npm run sync:enable
```

以下の処理が実行されます:

1. 現在の `settings.json` を `original-settings/` にバックアップ
2. リポジトリの `settings.json` へのシンボリックリンクを作成
3. 自動 pull をバックグラウンドタスクとして登録 (Mac: launchd / Windows: タスクスケジューラ)
   - PC 起動 (ログイン) 時に自動的に開始されます
   - 以降 1 時間ごとに `main` ブランチを pull します

### 同期を無効化する

```bash
npm run sync:disable
```

以下の処理が実行されます:

1. 自動 pull の登録を解除
2. シンボリックリンクを削除
3. バックアップから元の `settings.json` を復元

### 手動で pull する

```bash
npm run pull
```

## 設定ファイルのパス

| OS      | パス                                                    |
| ------- | ------------------------------------------------------- |
| Mac     | `~/Library/Application Support/Cursor/User/settings.json` |
| Windows | `%APPDATA%\Cursor\User\settings.json`                   |

## ログ

定期 pull の実行ログは `logs/pull.log` に出力されます (git 管理対象外)。

## ディレクトリ構成

```
cursor-settings/
├── package.json               # NPM スクリプト定義
├── settings.json              # 共有設定ファイル (git 管理)
├── scripts/
│   ├── enable.mjs             # sync:enable の実装
│   ├── disable.mjs            # sync:disable の実装
│   ├── pull.mjs               # 定期 pull スクリプト
│   └── utils.mjs              # 共通ユーティリティ
├── original-settings/         # 元の設定のバックアップ (git 管理対象外)
├── logs/                      # 実行ログ (git 管理対象外)
├── .gitignore
├── LICENSE
└── README.md
```

## 注意事項

- `settings.json` を編集した後は、コミット & プッシュすることで他のデバイスに反映されます
- `sync:disable` を実行すれば、元の設定に完全に復元されます (不可逆的な変更は残りません)
