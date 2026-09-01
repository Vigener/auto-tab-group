// デフォルト設定
const DEFAULT_SETTINGS = {
  autoNameGroup: false,      // 親タイトルをグループ名に適用（デフォルト: OFF）
  autoUngroupSingle: true    // 1タブのみになったらグループ解除（デフォルト: ON）
};

// 設定を取得するヘルパー関数
async function getSettings() {
  try {
    return await chrome.storage.sync.get(DEFAULT_SETTINGS);
  } catch (err) {
    console.debug("Failed to get settings, using defaults:", err);
    return DEFAULT_SETTINGS;
  }
}

// 1タブのみのグループをチェックして解除する関数
let ungroupTimer = null;
function scheduleSingleTabGroupCheck(windowId) {
  if (ungroupTimer) {
    clearTimeout(ungroupTimer);
  }
  ungroupTimer = setTimeout(() => {
    checkSingleTabGroups(windowId);
  }, 150);
}

async function checkSingleTabGroups(windowId) {
  const settings = await getSettings();
  if (!settings.autoUngroupSingle) {
    return;
  }

  try {
    const query = windowId ? { windowId } : {};
    const groups = await chrome.tabGroups.query(query);

    for (const group of groups) {
      const tabs = await chrome.tabs.query({ groupId: group.id });
      // グループ内のタブが1個だけになったらグループを解除
      if (tabs.length === 1) {
        await chrome.tabs.ungroup(tabs[0].id);
      }
    }
  } catch (error) {
    console.debug("Check single tab groups error:", error);
  }
}

// 新規タブ作成リスナー（親タブから開かれた子タブを自動グループ化）
chrome.tabs.onCreated.addListener(async (newTab) => {
  // リンククリック等で作成されたタブ（openerTabIdが存在する）か判定
  if (!newTab.openerTabId || !newTab.id) {
    return;
  }

  try {
    const parentTab = await chrome.tabs.get(newTab.openerTabId);

    // 親タブが存在しない、または別ウィンドウ等の場合はスキップ
    if (!parentTab || parentTab.windowId !== newTab.windowId) {
      return;
    }

    const settings = await getSettings();

    if (parentTab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
      // 親タブがグループ未所属の場合: 親と子の両方を含む新しいグループを作成
      const groupId = await chrome.tabs.group({
        tabIds: [parentTab.id, newTab.id]
      });

      // 自動グループ名付与がONの場合のみタイトルを設定
      if (settings.autoNameGroup && parentTab.title) {
        let groupTitle = parentTab.title.trim();
        if (groupTitle.length > 25) {
          groupTitle = groupTitle.slice(0, 22) + "...";
        }
        await chrome.tabGroups.update(groupId, {
          title: groupTitle
        });
      }
    } else {
      // 親タブが既にグループ所属の場合: 既存グループに子タブを追加
      await chrome.tabs.group({
        groupId: parentTab.groupId,
        tabIds: newTab.id
      });
    }
  } catch (error) {
    console.debug("Auto Tab Group processing error:", error);
  }
});

// タブが閉じられたときのリスナー
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  if (!removeInfo.isWindowClosing) {
    scheduleSingleTabGroupCheck(removeInfo.windowId);
  }
});

// タブの所属グループが変更されたときのリスナー（ドラッグで外に出された場合など）
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.groupId !== undefined) {
    scheduleSingleTabGroupCheck(tab.windowId);
  }
});

// タブが別ウィンドウへ移動（デタッチ）されたときのリスナー
chrome.tabs.onDetached.addListener((tabId, detachInfo) => {
  scheduleSingleTabGroupCheck(detachInfo.oldWindowId);
});

