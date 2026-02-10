# Prizm Git 子模块配置指南

Prizm 作为独立公开项目，在 sapphire-next 中以 **Git Submodule** 形式集成。本指南说明如何配置和日常开发。

## 一、首次配置（将现有 prizm 转为子模块）

**前提**：prizm 已推送到公开仓库（如 `https://github.com/hymnly133/prizm.git`）

### 步骤

1. **在 prizm 目录内提交并推送所有改动**

   ```bash
   cd prizm
   git add .
   git commit -m "chore: sync before submodule setup"
   git push origin main
   ```

2. **回到 sapphire-next 根目录，添加 prizm 为子模块**

   ```bash
   cd ..   # 回到 sapphire-next 根目录
   
   # 先备份当前 prizm（含未提交改动时可选）
   # mv prizm prizm_backup
   
   # 删除现有 prizm 目录（子模块 add 会重新克隆）
   Remove-Item -Recurse -Force prizm
   
   # 添加为子模块
   git submodule add https://github.com/hymnly133/prizm.git prizm
   
   git add .gitmodules prizm
   git commit -m "chore: add prizm as submodule"
   ```

3. **若之前备份了 prizm_backup**，可选择性合并未提交改动到新子模块后再删除备份。

---

## 二、日常开发 Prizm

在 `prizm/` 目录内按普通 Git 仓库操作即可：

```bash
cd prizm
git status
git add .
git commit -m "feat: xxx"
git push origin main
```

改完 prizm 后，如需让 sapphire-next 锁定到新版本：

```bash
cd ..   # 回到 sapphire-next 根目录
git add prizm
git commit -m "chore: update prizm submodule"
git push
```

---

## 三、他人克隆 sapphire-next 时

克隆时一次性拉取子模块：

```bash
git clone --recurse-submodules https://github.com/xxx/sapphire-next.git
cd sapphire-next
yarn install
```

如果已用普通 `git clone` 克隆，需再初始化子模块：

```bash
git submodule update --init --recursive
yarn install
```

---

## 四、常用子模块命令

| 场景           | 命令 |
|----------------|------|
| 更新子模块到远程最新 | `git submodule update --remote prizm` |
| 查看子模块状态     | `git submodule status` |
| 拉取父仓库时同步子模块 | `git pull --recurse-submodules` |

---

## 五、本地开发注意事项

- **Prizm 独立仓库**：`prizm/` 有独立 `.git`，直接在其中开发、提交、推送即可。
- **Yarn Workspace**：sapphire-next 的 `package.json` 已包含 `prizm`、`prizm/panel`，`yarn install` 会正确链接。
- **本地数据**：`.prizm-data/` 已加入 `.gitignore`，不会提交到 prizm 仓库。
