//插件功能简介：用于保存同一网站的不同cookie，用户的每个网页对于同一网站有不同cookie，可以方便切换cookie， Account：键为域名加上网页标签的位置，值为cookie，trackedDomains：需要追踪，自动保存新的cookie的域名。 8.7
//目前的逻辑是同一时间对一个网站只存在一种cookie,如果要切换到具有新的cookie的相同根域名网页，则用新的cookie替换旧的cookie 8.7

// 保存原始的 console.error 方法
// const originalConsoleError = console.error;

// // 重写 console.error 方法
// console.error = function(...args) {
//   // 调用原始的 console.error 方法，以便错误仍然在控制台中打印
//   originalConsoleError.apply(console, args);

//   // 创建一个错误消息
//   const errorMessage = args.join(' ');

//   // 这里可以添加你想要的额外逻辑，例如发送消息到内容脚本或弹出页等
//   // 你可能想要根据具体需求定制此部分

//   // 示例：显示通知（请确保你的扩展具有必要的通知权限）
//   chrome.notifications.create({
//     type: 'basic',
//     iconUrl: 'icon.png', // 你的图标 URL
//     title: 'An Error Occurred',
//     message: errorMessage,
//   });
// };

// const cookieData = {
//   url: 'https://www.kaggle.com', // 注意：这里要使用完整的 URL，不只是域名
//   name: 'XSRF-TOKEN',
//   value:
//     'CfDJ8OUZZhoRU_5EmXzVc6iDdFXW8cpbSNz8INncfKDgGfmL-PehWnafALj7ZbeD_nWKR7txAy_8EQr81AzD6VKoeKVh-KYucnSPjBvmFzGM9JZSNQ',
//   domain: '.www.kaggle.com',
//   path: '/',
//   secure: true,
//   httpOnly: false,
//   sameSite: 'lax',
//   storeId: '0', // 通常，你可能不需要设置这个，除非你有特定的需求
//   // 注意：因为 "session" 是 true，所以我们没有设置 "expirationDate"
// }

// chrome.cookies.set(cookieData, function (result) {
//   if (chrome.runtime.lastError) {
//     console.error(chrome.runtime.lastError)
//   } else {
//     console.log('Cookie set successfully!', result)
//   }
// })

type SameSiteStatus = 'no_restriction' | 'lax' | 'strict' | 'None'

type CookieType = {
  domain: string
  expirationDate?: number // 使用 `?` 来标记这个属性是可选的
  httpOnly: boolean
  name: string
  path: string
  sameSite: SameSiteStatus
  secure: boolean
  session?: boolean
  value: string
  url: string
}
// 定义接口和类型
interface Account {
  cookies: chrome.cookies.Cookie[]
  manualSave?: boolean
  closed?: boolean
}

// 定义变量的类型
let accounts: Record<string, Account> = {}
let trackedDomains: string[] = []

interface SaveCookiesRequest {
  action: 'saveCookies'
  account: string
}

interface LoadCookiesRequest {
  action: 'loadCookies'
  account: string
}

interface ClearCookiesRequest {
  action: 'clearCookies'
}

interface SaveAllCookiesRequest {
  action: 'saveAllCookies'
}

interface LoadAllCookiesRequest {
  action: 'loadAllCookies'
}

interface ClearAllClosedCookiesRequest {
  action: 'clearAllClosedCookies'
}

type RequestAction = SaveCookiesRequest | LoadCookiesRequest | ClearCookiesRequest | SaveAllCookiesRequest | LoadAllCookiesRequest | ClearAllClosedCookiesRequest

// chrome.storage.sync.clear(function () {
//   console.log('所有云端同步数据已清除')
// })

// chrome.storage.local.clear(function () {
//   console.log('所有本地同步数据已清除')
// })

//以下代码中打开option页用于调试
chrome.runtime.onInstalled.addListener(function (details) {
  if (details.reason === 'install') {
    //|| details.reason === 'update'
    chrome.runtime.openOptionsPage()
  }
})

chrome.storage.sync.set({ trackedDomains: JSON.stringify(['kaggle.com', 'saturnenterprise.io', 'twitter.com', 'bilibili.com']) })

//accounts存放在local，domains存放在sync
chrome.storage.local.get('accounts', function (result) {
  if (result.accounts) {
    accounts = result.accounts
  }
})

// Load the initial value of trackedDomains from storage
chrome.storage.sync.get('trackedDomains', function (result) {
  if (result.trackedDomains) {
    trackedDomains = JSON.parse(result.trackedDomains || '[]')
    console.log('trackedDomains in sync', trackedDomains)
  }
})

// Listen for changes to the sync area of Chrome storage\
chrome.storage.onChanged.addListener(function (changes, areaName) {
  if (areaName === 'local' && changes.accounts) {
    // Update the local variable with the new value from storage
    accounts = changes.accounts.newValue || {}
  }
})

// Listen for changes to the sync area of Chrome storage
chrome.storage.onChanged.addListener(function (changes, areaName) {
  if (areaName === 'sync' && changes.trackedDomains) {
    // Update the local variable with the new value from storage
    trackedDomains = changes.trackedDomains.newValue
    console.log('trackedDomains in chrome.storage.onChanged.addListener', trackedDomains)
  }
})

function getURLFromAccountKey(accountKey: string): string {
  return accountKey.split('-')[0]
}

//每次重新打开浏览器插件时，需要检测一遍这个浏览器窗口的所有标签页，看是否和我现在账户列表里的域名加标签位置的域名是否匹配,如果不匹配，就把账户里对应的选项给删除 8.14
//这里如果初始化的话应该把ID全部重置为一个负值(-1)，这样就不会和正常的ID冲突了 8.22
async function checkTabsAndCleanAccounts() {
  const result = await chrome.storage.local.get('accounts')
  accounts = result.accounts || {}
  // 创建一个新的对象来存储修改后的账户
  const updatedAccounts: Record<string, Account> = {}
  Object.keys(accounts).forEach((accountKey) => {
    const modifiedKey = modifyTabIdFromKey(accountKey, true)
    // 将修改后的键及其对应的值放回新的对象
    updatedAccounts[modifiedKey] = accounts[accountKey]
  })
  console.log('已经修改不存在的选项卡cookie in checkTabsAndCleanAccounts')
  // 将更新后的账户列表保存回插件的存储
  chrome.storage.local.set({ accounts: updatedAccounts })

  // 更新全局变量
  accounts = updatedAccounts
}
// 在插件启动时调用此函数
chrome.runtime.onStartup.addListener(checkTabsAndCleanAccounts)

// 在插件启动时调用此函数
// checkTabsAndCleanAccounts()

//可能还少检查了一步，如果cookies的domain和你从网址中读取的怎么不一样,我觉得最好是在你手动读取的domain前面加一个点
chrome.runtime.onMessage.addListener(async (request: RequestAction, _sender: chrome.runtime.MessageSender, _sendResponse: (response: any) => void) => {
  if (request.action == 'saveCookies') {
    try {
      console.log('手动saveCookies已经触发')
      // 获取当前活动窗口的活动标签
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
      // 在调用之后打印返回的tabs数组
      console.log('Tabs returned from query: ', tabs)

      // 可以进一步检查tabs数组的长度，以确定是否有找到活动标签
      if (tabs.length === 0) {
        console.error('No active tab found in current window in savecookies manually.')
        return
      }

      const [rootDomain, key, isNotInDomain] = processDomain(tabs[0], false) as [string, string, boolean]
      if (isNotInDomain) {
        trackedDomains.push(rootDomain as string)
        await chrome.storage.sync.set({
          trackedDomains: JSON.stringify(trackedDomains),
        })
      } else {
        console.log('this domain is not added in savecookies manually because it has been added before')
      }

      if (request.account in accounts) {
        await saveCurrentCookies(rootDomain, key, request.account)
      } else {
        console.log("We don't receive the account you select in saveCookies manually", 'accounts:', accounts, 'request.account:', request.account)
      }
    } catch (error) {
      console.log('An error occurred in saveCookies manually:', error)
    }
  } else if (request.action == 'loadCookies') {
    console.log('手动loadCookies已经触发')
    try {
      if (request.account in accounts && accounts[request.account]) {
        // Get the URL for the account
        const url = getURLFromAccountKey(request.account)
        // Load cookies for this account
        const rootDomain = getRootDomain(url)
        if (rootDomain) {
          await loadCookies(rootDomain, accounts[request.account].cookies)
          //加载好cookies之后要刷新页面 8.25
          const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
          if (tabs[0] && tabs[0].id) {
            await chrome.tabs.reload(tabs[0].id)
          } else {
            console.log('tabs[0]不存在，无法刷新页面 in loadCookies manually.')
          }
        } else {
          console.error('Unable to get rootDomain from url in loadCookies manually.')
        }
      } else {
        console.log('No cookies saved for this account 在手动loadCookies中.')
      }
    } catch (error) {
      console.log('An error occurred in loadCookies manually:', error)
    }
  } else if (request.action == 'clearCookies') {
    // 获取当前活动窗口的活动标签
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tabs.length === 0) {
      console.error('No active tab found in current window in savecookies manually.')
      return
    }
    const [rootDomain, key] = processDomain(tabs[0]) as [string, string]
    clearCookiesForDomain(rootDomain)
  } else if (request.action == 'saveAllCookies') {
    saveUniqueAccounts(accounts)
  } else if (request.action == 'loadAllCookies') {
    const result = await chrome.storage.local.get('savedAccounts')
    console.log('data.savedAccounts in Service Woker', result.savedAccounts)
    accounts = result.savedAccounts || {}
    const newAccounts: Record<string, Account> = {}

    for (const [key, account] of Object.entries(accounts)) {
      const cookieUrl = (account.cookies[0].secure ? 'https://' : 'http://') + account.cookies[0].domain.replace(/^\./, '')
      const tab = await chrome.tabs.create({ url: cookieUrl, active: false })
      console.log('In loadAllCookies, 新标签页的 ID 是:', tab.id)
      const rootDomain = getRootDomain(account.cookies[0].domain)
      const newKey = rootDomain + '-' + tab.id
      newAccounts[newKey] = account // 将账户添加到新对象中，使用新键
    }
    // 用新对象替换原始对象
    await chrome.storage.local.set({ savedAccounts: newAccounts })
    //接下来不需要手动更新accounts，因为这个属性是被监听的，它会自动更新
    console.log('Updated accounts saved successfully!')
  } else if (request.action == 'clearAllClosedCookies') {
    removeClosedAccounts()
  }
})

function areAccountsSame(account1: Account, account2: Account): boolean {
  if (account1.cookies.length !== account2.cookies.length) return false
  //The first method is to use the for loop to check, assuming cookies are organized
  for (let i = 0; i < account1.cookies.length; i++) {
    const cookie1 = account1.cookies[i]
    const cookie2 = account2.cookies[i]

    if (!isCookiePresent([cookie1], cookie2)) {
      return false
    }
  }

  return true
  //The second method is to use the every() method to check, assuming cookies are unorganized
  // return account1.cookies.every((cookie1) => isCookiePresent(account2.cookies, cookie1))
}

async function saveUniqueAccounts(accounts: Record<string, Account>): Promise<void> {
  const uniqueAccounts: Record<string, Account> = {}
  const result = await chrome.storage.local.get('accounts')
  accounts = result.accounts || {}
  for (const [key1, account1] of Object.entries(accounts)) {
    let isUnique = true

    for (const [key2, account2] of Object.entries(accounts)) {
      if (key1 !== key2 && areAccountsSame(account1, account2)) {
        isUnique = false
        break
      }
    }

    if (isUnique) {
      uniqueAccounts[key1] = account1
    }
  }

  // 保存独特的账户
  await chrome.storage.local.set({ savedAccounts: uniqueAccounts })
  console.log('Unique accounts saved successfully!')
}

let clearCookiesEnabled = false // 开关状态

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.clearCookiesEnabled !== undefined) {
    clearCookiesEnabled = message.clearCookiesEnabled // 更新开关状态
  }
})

let currentTabId: number | null = null

//这段代码的作用是当用户离开网页的时候，保存这个网页cookie，同时在进入的网页加载new网页的cookie
chrome.tabs.onActivated.addListener(function (activeInfo) {
  handleTabChange(activeInfo.tabId)
})

async function removeClosedAccounts() {
    const result = await chrome.storage.local.get('accounts')
    accounts = result.accounts || {}
  // 创建一个新的对象来存储未被删除的账户
  const updatedAccounts: Record<string, Account> = {}

  // 遍历现有的账户
  for (const [key, account] of Object.entries(accounts)) {
    // 如果账户没有被标记为删除，则添加到新的对象中
    if (!account.closed) {
      updatedAccounts[key] = account
    }
  }

  // 更新全局变量
  accounts = updatedAccounts

  // 将更新后的账户列表保存回插件的存储
  await chrome.storage.local.set({ accounts: updatedAccounts })
  console.log('已经删除所有标记为删除的账户 in removeDeletedAccounts')
}

chrome.windows.onRemoved.addListener(function (windowId) {
  removeClosedAccounts()
  console.log('已经删除所有标记为closed的账户 in onRemoved')
  console.log(`Window with ID ${windowId} has been removed.`)
})

// 下面的代码可以在后期的提高efficiency，但是我现在先不使用, 其实还是原来的方法效率高，因为原来是离开网页的时候就把cookies给删除加快了速度，但是原来不能处理用户进入了需要追踪域名后离开域名又再次进入的情况（因为没有触发onactivated）
//需要实现的功能，如果当前tab已经在账户中有对应的键了，那就不要再删除了,因为能够自动更新
// const tabDomains: Record<number, string> = {} // 用于存储每个选项卡的当前URL

// chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
//   const newDomain = getRootDomain(changeInfo.url as string)
//   if (newDomain) {
//     const oldDomain = tabDomains[tabId] // 获取该选项卡的之前的URL

//     if ((!oldDomain || oldDomain !== newDomain) && trackedDomains.includes(newDomain)) {
//       console.log(`Domain has changed from ${oldDomain} to ${newDomain}, so it will trigger handleTabChange`)

//       chrome.runtime.sendMessage({ action: 'showMask' }) // 显示遮罩层
//       handleTabChange(tabId)
//     }
//     tabDomains[tabId] = newDomain // 更新URL
//   }
// })

// const tabsState: Record<number, boolean> = {}
// chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
//   if (changeInfo.url && changeInfo.url.includes('www.example.com')) {
//     // 检查此标签页是否已经访问过特定域名
//     if (!tabsState[tabId]) {
//       // 如果是第一次访问，记录状态并触发代码
//       tabsState[tabId] = true
//       console.log('First time accessing www.example.com in this tab')
//       // 在此处触发你的代码
//     } else {
//       console.log('Not the first time accessing www.example.com in this tab')
//     }
//   }
// })

// // 清理已关闭的标签的URL
// chrome.tabs.onRemoved.addListener(function (tabId) {
//   delete tabDomains[tabId]
// })

// 创建一个对象来存储选项卡的索引信息
// const tabIndexMap: {
//   [tabId: number]: { url: string | undefined; index: number }
// } = {}

// // 监听选项卡更新事件，存储选项卡索引
// chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
//   if (typeof tab.index !== 'undefined') {
//     tabIndexMap[tabId] = { url: tab.url, index: tab.index }
//   }
// })

function extractTabIdFromKey(key: string, modify = false) {
  const keyParts = key.split('-')
  if (modify) {
    return keyParts[0] + '-' + '-1'
  }
  return keyParts[keyParts.length - 1] // tabID存储在键的最后一部分
}

const modifyTabIdFromKey = extractTabIdFromKey

// Handle tab closure events
chrome.tabs.onRemoved.addListener(async function (tabId, _removeInfo) {
  try {
        const result = await chrome.storage.local.get('accounts')
        accounts = result.accounts || {}
    for (const key in accounts) {
      const storedTabId = extractTabIdFromKey(key)
      if (storedTabId === String(tabId)) {
        // delete accounts[key]
        accounts[key].closed = true
      }
    }
    // 存储更新后的`accounts`对象
    await chrome.storage.local.set({ accounts: accounts })
  } catch (error) {
    console.log('An error occurred in remove listener:', error)
  }
})

//这段代码的功能是激活新的tab时,先保存旧的页面的 cookies，然后清除旧的页面的cookies，然后加载新的页面的cookies
async function handleTabChange(tabId: number) {
  // If there is a currently active tab, save its cookies
  try {
            const result = await chrome.storage.local.get('accounts')
            accounts = result.accounts || {}
    if (currentTabId !== null) {
      const tab = await chrome.tabs.get(currentTabId)
      console.log('The tab we have just left:', tab.url)

      const [rootDomain, key] = processDomain(tab) as [string, string]
      // chrome.tabs.sendMessage(tabId, { action: 'showMask' }) // To show the mask in the content script, corresponding with onUpdated 8.26

      await saveCurrentCookies(rootDomain, key)
      console.log('handleTabChange中saveCurrentCookies已触发')

      //用户可以选择是否清除
      if (!clearCookiesEnabled) {
        return
      }
      //load之前先把已经存在的cookie删除 8.18
      await clearCookiesForDomain(rootDomain)
    }
  } catch (error) {
    console.log('在handletapchange中需要忽视的报错processDomain报错,发生在保存以及清除cookies时', error)
  }

  // Update the currently active tab ID
  currentTabId = tabId
  //If the code below can't load cookies, then selected account is empty
  await chrome.storage.sync.set({ selectedAccount: '' })

  try {
    // Get the URL and index of the newly activated tab
    const tab = await chrome.tabs.get(currentTabId)
    const [rootDomain, key] = processDomain(tab) as [string, string]
    //make new links only open in the current tab 8.26
    await modifyLinksInTab(tabId)
    // Load the appropriate cookies
    if (key in accounts && accounts[key]) {
      //让popup页面显示当前所在的账户，popup页面的显示是通过sync.get来实现的(由于每次打开会自动获取，所以不需要持续监听) 为什么要写把这个放在if语句里面?因为这说明这是一个新打开的页面,暂时不保存可以方便用户创建自己的账户
      await chrome.storage.sync.set({ selectedAccount: key })
      await injectMaskScript(tabId)

      await loadCookies(rootDomain, accounts[key].cookies)

      // chrome.tabs.sendMessage(tabId, { action: 'hideMask' }) // To hide the mask in the content script, corresponding with onUpdated 8.26
      await removeMaskScript(tabId)
    } else {
      console.log('域名为追踪域名，但是当前域名-索引没有在保存账户中,所以无法从中加载cookies')
    }
  } catch (error) {
    console.log('An error occurred in handleTabChange in loadCookies:', error)
  }
}

// Save the current cookies for the specified tab
async function saveCurrentCookies(rootDomain: string, key: string, manualSave: boolean | string = false): Promise<void> {
  try {
            const result = await chrome.storage.local.get('accounts')
            accounts = result.accounts || {}
    // Save the current cookies for this URL and tab index
    const cookies = await chrome.cookies.getAll({ domain: rootDomain })

    // 确保 accounts[key] 已初始化
    accounts[key] = accounts[key] || {}
    accounts[key].cookies = cookies
    //When we use savecookies manually, we should reset the value of manualsave
    if (typeof manualSave == 'string') {
      //在手动保存的时候会把 Account的key给传进来,自动保存为正常的boolen
      accounts[key].manualSave = !!manualSave
    }
    console.log('成功保存cookie, account key为:', key)

    await chrome.storage.local.set({ accounts: accounts })
  } catch (error) {
    console.log('An error occurred in saveCurrentCookies. Notice this error may cause the function not work:', error)
  }
}

// 辅助函数：根据 cookie 名称调整 cookie 属性
function adjustCookieForSpecialNames(cookie: any) {
  // 如果 cookie 名称以 "__Host-" 开头
  if (cookie.name.startsWith('__Host-')) {
    delete cookie.domain // 移除 domain 属性
  }
  return cookie
}

function isCookiePresent(existingCookies: chrome.cookies.Cookie[], cookieToCheck: chrome.cookies.Cookie): boolean {
  return existingCookies.some(
    (existingCookie) =>
      existingCookie.name === cookieToCheck.name && existingCookie.value === cookieToCheck.value && existingCookie.path === cookieToCheck.path && existingCookie.domain === cookieToCheck.domain
  )
}

// Load the specified cookies for the specified URL
async function loadCookies(rootDomain: string, cookies: chrome.cookies.Cookie[]): Promise<void> {
  try {
    console.log('loadCookies已触发,clear的输出应该在此之前')
    const existingCookies = await chrome.cookies.getAll({ domain: rootDomain })
    const promises = Object.values(cookies).map(async (cookie) => {
      if (!isCookiePresent(existingCookies, cookie)) {
        const cookieUrl = (cookie.secure ? 'https://' : 'http://') + cookie.domain.replace(/^\./, '') // 移除域名开始的点
        if (cookie.sameSite == undefined) {
          console.log('cookie.sameSite:', cookie.sameSite)
          cookie.sameSite = 'None'
        }
        const origin_cookie = {
          url: cookieUrl,
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path,
          secure: cookie.secure,
          httpOnly: false,
          // sameSite: cookie.sameSite,
          sameSite: 'strict',
          expirationDate: cookie.expirationDate,
        }
        // const fixedCookie = fixCookieDomainAndUrl(origin_cookie)
        // 使用辅助函数来调整特殊名称的 cookie 属性,suah as '_Host'
        const fixedCookie = adjustCookieForSpecialNames(origin_cookie)
        console.log('以下cookie将要被设置:', fixedCookie)
        await chrome.cookies.set(fixedCookie)
        console.log('Cookie set successfully in loadcookies!')
      } else {
        console.log('%c Cookie already exists, skip setting.', 'background: #ff0000; color: #fff')
      }
    })

    // Wait for all cookies to be processed
    await Promise.all(promises)

    // 在所有的 cookies 处理完成后存储 accounts
    // await chrome.storage.local.set({ accounts: accounts })
  } catch (error) {
    console.log('An error occurred in loadCookies:', error)
  }
}

// 清除特定域名的所有 cookies
async function clearCookiesForDomain(domain: string) {
  try {
    const cookies = await chrome.cookies.getAll({ domain })

    console.log('%c ---------------------------------------------------', 'background: #00ff00; color: #000')
    console.log(`%c Found ${cookies.length} cookies for domain: ${domain}`, 'background: #00ff00; color: #000')

    const promises = cookies.map(async (cookie) => {
      const { name, domain, storeId } = cookie
      const url = 'http' + (cookie.secure ? 's' : '') + '://' + domain

      const result = await chrome.cookies.remove({ url, name, storeId })

      if (!result) {
        console.error(`%c Failed to remove cookie named ${name} from ${url}.`, 'background: #ff0000; color: #fff')
      } else {
        console.log(`%c Successfully removed cookie named ${name} from ${url}.`, 'background: #00ff00; color: #000')
      }
    })

    // Once all cookies are removed, print the final log line
    await Promise.all(promises)
    console.log('%c ------------------------------------------------------------------', 'background: #00ff00; color: #000')
  } catch (error) {
    console.error('%c Error during cookie operation:', 'background: #ff0000; color: #fff', error)
  }
}

chrome.tabs.onCreated.addListener(function (tab) {
  chrome.storage.sync.set({ selectedAccount: '' })
})
//下面的是不行的，因为创造的时候，它是创造一个空白标签，所以是没有用
// 监听标签页的创建事件
// chrome.tabs.onCreated.addListener(function(tab) {
//     if (clearCookiesEnabled && tab.url) {
//         // 检查开关是否启用和 URL 是否存在
//         const url = new URL(tab.url);
//         const domain = url.hostname;

//         if (trackedDomains.includes(domain)) {
//             clearCookiesForDomain(domain);
//             console.log('New tab is in trackedDomains, so we clear cookies,domain:',domain);
//         } else {
//             console.log('New tab is not in trackedDomains, so we do not clear cookies');
//         }
//     }
// });

// Handle tab move events
// chrome.tabs.onMoved.addListener(async function (tabId, moveInfo) {
//   try {
//     const tab = await chrome.tabs.get(tabId)
//     console.log('moved已经触发')
//     const [rootDomain, key]: [string, string] = processDomain(tab) as [string, string]

//     const oldKey = `${rootDomain}-${moveInfo.fromIndex}`
//     const newKey = `${rootDomain}-${moveInfo.toIndex}`

//     // 如果此标签索引的 cookies 被存储，则移动它们
//     if (oldKey in accounts) {
//       accounts[newKey] = accounts[oldKey]
//       delete accounts[oldKey]
//     }

//     // 更新其他受影响的标签
//     updateRemainingIndexes(tab.windowId, moveInfo.fromIndex, moveInfo.toIndex)
//   } catch (error) {
//     console.log('An error occurred in move listener:', error)
//   }
// })

// Handle tab detachment events
// chrome.tabs.onDetached.addListener(function (tabId, detachInfo) {
//   chrome.tabs.get(tabId, function (tab) {
//     console.log('detached已经触发')
//     processDomain(tab, (rootDomain, key) => {
//       const oldKey = `${rootDomain}-${detachInfo.oldPosition}`

//       // 如果此标签索引的 cookies 被存储，则将它们移动到临时键
//       if (oldKey in accounts) {
//         accounts[`temp-${tabId}`] = accounts[oldKey]
//         delete accounts[oldKey]
//       }

//       updateRemainingIndexes(detachInfo.oldWindowId, detachInfo.oldPosition)
//     })
//   })
// })

// Handle tab attachment events
// chrome.tabs.onAttached.addListener(function (tabId, attachInfo) {
//   chrome.tabs.get(tabId, function (tab) {
//     console.log('attached已经触发')
//     processDomain(tab, (rootDomain, key) => {
//       const newKey = `${rootDomain}-${attachInfo.newPosition}`

//       // 如果此标签索引的 cookies 被存储，则将它们移动到新的标签索引
//       if (`temp-${tabId}` in accounts) {
//         accounts[newKey] = accounts[`temp-${tabId}`]
//         delete accounts[`temp-${tabId}`]
//       }

//       updateRemainingIndexes(attachInfo.newWindowId, attachInfo.newPosition)
//     })
//   })
// })

// async function updateRemainingIndexes(windowId: number, oldPosition: number, newPosition = -1): Promise<void> {
//   try {
//     const tabs = await chrome.tabs.query({ windowId: windowId })
//     tabs.forEach(function (tab) {
//       const [rootDomain, key]: [string, string] = processDomain(tab) as [string, string]

//       if (newPosition === -1) {
//         // Handle detachment and attachment
//         //应该是旧的窗口，>的都要减一，新的窗口，>的都要加一
//         if (tab.index > oldPosition) {
//           updateKey(rootDomain, tab.index, tab.index - 1)
//         }
//       } else {
//         // Handle movement within the same window
//         if (newPosition > oldPosition) {
//           if (tab.index > oldPosition && tab.index <= newPosition) {
//             updateKey(rootDomain, tab.index, tab.index - 1)
//           }
//         } else {
//           if (tab.index >= newPosition && tab.index < oldPosition) {
//             updateKey(rootDomain, tab.index, tab.index + 1)
//           }
//         }
//       }
//     })
//     chrome.storage.local.set({ accounts: accounts })
//   } catch (error) {
//     console.log('An error occurred in updateRemainingIndexes:', error)
//   }
// }

// function updateKey(rootDomain: string, oldIndex: number, newIndex: number): void {
//   const oldKey = `${rootDomain}-${oldIndex}`
//   const newKey = `${rootDomain}-${newIndex}`

//   if (oldKey in accounts) {
//     accounts[newKey] = accounts[oldKey]
//     delete accounts[oldKey]
//   }
// }

function isValidURL(url: string): boolean {
  try {
    new URL(url)
    return true
  } catch (_) {
    return false
  }
}

function processDomain(tab: chrome.tabs.Tab, throwErrors = true): [string, string] | null | [string, string, boolean] {
  if (!tab) {
    throw new Error('Tab not found in processDomain')
  }
  if (tab.pendingUrl && isSpecialPage(tab.pendingUrl)) {
    throw new Error(`pendingUrl is specialPage  in processDomain: ${tab.pendingUrl}`)
  }

  if (!tab.url) {
    throw new Error(`URL not found for tab in processDomain: ${tab.id}`)
  }

  const url = new URL(tab.url).origin

  if (!isValidURL(url)) {
    throw new Error('Invalid URL in processDomain:' + url)
  }

  const rootDomain = getRootDomain(url)
  if (!rootDomain) {
    throw new Error('Root domain not found in processDomain.')
  }

  if (trackedDomains.includes(rootDomain)) {
    const key = `${rootDomain}-${tab.id}`
    return [rootDomain, key]
  } else {
    if (throwErrors) {
      throw new Error('This domain is not tracked in processDomain. Root domain: ' + rootDomain)
    } else {
      const key = `${rootDomain}-${tab.id}`
      return [rootDomain, key, true]
    }
  }
}

function getRootDomain(url: string): string | null {
  try {
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'http://' + url // 添加默认的 http 协议
    }
    const domain = new URL(url).hostname
    const parts = domain.split('.')
    if (parts.length < 2) return domain // 如果域名不包括至少两部分，则返回整个域名
    return parts.slice(-2).join('.') // 返回最后两个部分，用点连接
  } catch (e) {
    console.error('Invalid URL:', e)
    return null // 如果 URL 不合法，返回 null 或其他适当的默认值
  }
}

function isSpecialPage(pendingUrl: string) {
  return pendingUrl.startsWith('chrome://') || pendingUrl.startsWith('about:') || pendingUrl.startsWith('file://')
}

async function injectMaskScript(tabId: number) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: function () {
        // 创建遮罩层div
        const mask = document.createElement('div')
        mask.id = 'loading-mask'
        mask.style.position = 'fixed'
        mask.style.top = '0'
        mask.style.right = '0'
        mask.style.bottom = '0'
        mask.style.left = '0'
        mask.style.backgroundColor = 'rgba(0, 0, 0, 0.5)'
        mask.style.display = 'flex'
        mask.style.alignItems = 'center'
        mask.style.justifyContent = 'center'
        mask.style.zIndex = '1000'

        // 创建加载指示器div
        const loader = document.createElement('div')
        loader.className = 'loader'
        loader.style.width = '24px'
        loader.style.height = '24px'
        loader.style.border = '4px solid'
        loader.style.borderTop = '4px solid gray'
        loader.style.borderRadius = '50%'
        loader.style.animation = 'spin 1s linear infinite'

        // 添加加载指示器到遮罩层
        mask.appendChild(loader)

        // 添加遮罩层到页面
        document.body.appendChild(mask)

        // 可选：定义旋转动画
        const style = document.createElement('style')
        style.innerHTML = `
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
`
        document.head.appendChild(style)
      },
    })
    console.log('Mask script injected, handleTabChange中injectMaskScript触发')
  } catch (error) {
    console.log('Failed to inject mask script', error)
  }
}

async function removeMaskScript(tabId: number) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: function () {
        const mask = document.getElementById('loading-mask')
        if (mask) {
          mask.remove()
        }
      },
    })
    console.log('Mask script removed, handleTabChange中removeMaskScript触发')
  } catch (error) {
    console.log('Failed to remove mask script', error)
  }
}

async function modifyLinksInTab(tabId: number) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: function () {
        const links = document.querySelectorAll('a')
        links.forEach((link) => {
          link.target = '_self' // 设置或重写 target 属性，确保在当前窗口打开
          console.log('Hello world=-------------------------------------------')
        })
        document.addEventListener('DOMContentLoaded', function () {
          const links = document.querySelectorAll('a')
          links.forEach((link) => {
            link.addEventListener('click', function (event) {
              event.preventDefault() // 阻止默认行为
              window.location.href = link.href // 在当前窗口中导航
              console.log('Hello world=-------------------------------------------')
            })
          })
        })
      },
    })
    console.log('Links modified to open in the same tab.')
  } catch (error) {
    console.log('Failed to modify links', error)
  }
}

// function fixCookieDomainAndUrl(cookie: CookieType) {
//   const fixedCookie = { ...cookie }

//   // Fix the domain
//   if (fixedCookie.domain.startsWith('.www.')) {
//     fixedCookie.domain = fixedCookie.domain.replace('.www.', '.')
//   }

//   // Fix the url
//   if (fixedCookie.url.includes('://.www.')) {
//     fixedCookie.url = fixedCookie.url.replace('://.www.', '://www.')
//   }

//   return fixedCookie
// }

// function getRootDomain(url: string): string | null {
//   try {
//     if (!url.startsWith('http://') && !url.startsWith('https://')) {
//       url = 'http://' + url // 添加默认的 http 协议
//     }
//     const domain = new URL(url).hostname // 使用 URL 类来解析域名
//     const parts = domain.split('.').reverse()

//     if (
//       parts.length > 2 &&
//       parts[1].match(/^(com|co|org|gov|edu|ac|net|mil)$/)
//     ) {
//       return parts[2] + '.' + parts[1] + '.' + parts[0]
//     } else {
//       return parts[1] + '.' + parts[0]
//     }
//   } catch (e) {
//     return null // 如果 URL 不合法，返回 null 或其他适当的默认值
//   }
// }
