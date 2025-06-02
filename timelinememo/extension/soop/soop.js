console.log("location.hostname", location.hostname);
const isLive = location.hostname.startsWith("play");
const isVOD = location.hostname.startsWith("vod");

const chat_title_selector = '.chat_title';
const timequery_selector = isLive
  ? '#time'
  : isVOD
  ? '.time-current'
  : null; // fallback 값

const vod_img_selector = 'meta[property="og:image"]';
const broadtime_selector = '.broad_time';
const vod_streamer_selector = '.thumbnail_box a';

const nowtime_selector = 'meta[property="og:updated_time"]';

const broadtime_regex = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/g
const vod_streamer_regex = /ch\.sooplive\.co\.kr\/([^/]+)/
const timestamps_regex = /\d{2}:\d{2}:\d{2}/g
const timestamp_regex = /\d{2}:\d{2}:\d{2}/

function waitForElement(selector, timeout = 5000) {
    return new Promise((resolve, reject) => {
        const el = document.querySelector(selector);
        if (el) {
            console.log(`바로 찾음: ${selector}`);
            return resolve(el);
        }

        console.log(`🔍 감시 시작: waitForElement(${selector})`);

        const observer = new MutationObserver(() => {
            const element = document.querySelector(selector);
            if (element) {
                console.log(`감시 후 찾음: ${selector}`);
                observer.disconnect();
                resolve(element);
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });

        setTimeout(() => {
            observer.disconnect();
            reject(`⏱️ ${selector} 요소가 ${timeout}ms 내에 나타나지 않았습니다.`);
        }, timeout);
    });
}

function getTimestamp(timequery_selector){
    if (timequery_selector){
        const timeText = document.querySelector(timequery_selector)?.innerText.trim();
        return timeText || '';
    } 
    return ''        
}

async function waitForGetStartUnixTime(timequery_selector = '.soop-time', timeout = 5000) {
    console.log('waitForGetStartUnixTime 시작');
    try {
        const targetNode = await waitForElement(timequery_selector, timeout);

        return new Promise((resolve, reject) => {
            const observer = new MutationObserver(() => {
                const timestamp = targetNode?.innerText.trim();
                if (timestamp && timestamp !== "00:00:00") {
                    console.log(`✅ timestamp 감지됨: ${timestamp}`);
                    observer.disconnect();
                    resolve(timestamp);
                }
            });

            observer.observe(targetNode, {
                childList: true,
                subtree: true,
                characterData: true,
            });

            setTimeout(() => {
                observer.disconnect();
                reject(`⏱️ ${timequery_selector} 요소가 ${timeout}ms 내에 유효한 timestamp를 가지지 않았습니다.`);
            }, timeout);
        });
    } catch (err) {
        throw new Error(`waitForElement 실패: ${err}`);
    }
}


// 실행
// (async () => {
//     try {
//         console.log('📦 스크립트 시작');
//         const result = await waitForGetStartUnixTime(timequery_selector);
//         console.log('✅ 결과:', result);
//     } catch (err) {
//         console.error('❌ 에러 발생:', err);
//     }
// })();

function waitForGetStartUnixTime2(callback) {
    const interval = setInterval(() => {
        const timestamp = getTimestamp(timequery_selector)

        // 유효하지 않은 경우 skip
        if (!timestamp || timestamp === "00:00:00") return;

        clearInterval(interval);
        
        const nowUnix = getNowTime(document.querySelector(nowtime_selector));
        const seconds = timestampToSeconds(timestamp);
        const startUnixTime = nowUnix - seconds;
        
        callback(startUnixTime);
        
    }, 300);
}
// 생방송 페이지: 스트리머명 & 방송번호 추출
function getLiveInfo() {
    const match = location.href.match(/play\.sooplive\.co\.kr\/([^/]+)\/(\d+)/);
    return match ? { streamer: match[1], number: match[2] } : null;
}

function getNowTime(El) {
    const nowUnix = parseInt(El.content, 10) || 0;
    if (!nowUnix) console.warn(`get NowTime failed`);
    return nowUnix
}

async function getInformForLive() {
    try {
        console.log(`getInformForLive 시작`)
        const [livePlayTimeStamp, nowTimeEl, chatSettingEl] = await Promise.all([
            waitForGetStartUnixTime(timequery_selector),
            waitForElement(nowtime_selector),
            waitForElement(chat_title_selector)
        ]);
        const nowUnix = getNowTime(nowTimeEl);
        if (!nowUnix) console.warn(`getInformForLive: get nowUnix failed`)
        const seconds = timestampToSeconds(livePlayTimeStamp);
        if (!seconds) console.warn(`getInformForLive: get Timestamp failed`)
        const startUnixTime = nowUnix - seconds;

        return [startUnixTime, chatSettingEl]

    } catch (err) {
        console.warn('❗ 요소를 모두 찾지 못했습니다:', err);
    }
}



function getBroadTime(el) {
    if (!el) console.warn(`getBroadTime failed`);
    const text = el.getAttribute('tip') || "";
    const match = text.match(broadtime_regex)?.map(date => dateFormatToUnixTime(date));
    if (match.length != 2) console.warn(`getBroadTime 오류 VOD 파싱 수정 필요`, match) 
    return match;
}

function getStreamerFromVOD(el) {
    if (!el) console.warn(`getStreamerFromVOD failed`);
    const href = el.getAttribute('href');
    const match = href?.match(vod_streamer_regex);
    return match ? match[1] : null;
}

async function getInformForVod() {
    try {
        const [broadTimeEl, vodLinkEl, chatSettingEl] = await Promise.all([
            waitForElement(broadtime_selector),
            waitForElement(vod_streamer_selector),
            waitForElement(chat_title_selector)
        ]);

        const [recordingTimeUnix, recordCloseTimeUnix] = getBroadTime(broadTimeEl);
        const streamer = getStreamerFromVOD(vodLinkEl);
        console.log('getInformForVod output: ',[recordingTimeUnix, recordCloseTimeUnix, streamer, chat_title])
        return [recordingTimeUnix, recordCloseTimeUnix, streamer, chatSettingEl]        

    } catch (err) {
        console.warn('❗ 요소를 모두 찾지 못했습니다:', err);
    }
}


async function checkReplayVOD() {
    // og:image 메타태그 가져오기
    const ogImageMeta = await waitForElement(vod_img_selector);
    if (!ogImageMeta) return false;

    const imageUrl = ogImageMeta.getAttribute('content');
    
    // 원하는 URL 형식 검사
    const expectedPrefix = "https://videoimg.sooplive.co.kr";
    
    return imageUrl.startsWith(expectedPrefix);
}














function video_play(){
    const video = document.querySelector('video');
    if (video.paused) {
        console.log("일시정지 상태입니다.");
        video?.play();
    } else {
        console.log("재생 중입니다.");
        video?.pause();
    }
    
}












async function waitForQuerySelector(query) {
    return waitForElement(query)
        .then(() => {
            const span = document.querySelector(query)?? '';
            return span;
        })
        .catch((err) => {
            console.warn('[waitForElementById]:'+query, err);
            return ''; // 에러 발생 시 fallback 값 반환
        });
}



// 저장된 생방송 메모 리스트 반환
async function getStreamerData(streamer) {
    const allKeys = (await GM.listValues()) || []; // 모든 GM 저장 키 목록
    console.log('All Keys:', allKeys);

    const keys = allKeys.filter(k => k.startsWith(`live_${streamer}_`));
    console.log('Filtered Keys:', keys);

    const results = await Promise.all(
        keys.map(async (k) => ({
            key: k,
            number: k.split('_')[2],
            content: await GM.getValue(k)
        }))
    );
    console.log('Results:', results);

    return results;
}


