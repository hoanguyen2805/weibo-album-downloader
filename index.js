const superAgent = require('superagent');
const fs = require('fs');
const http = require('http');
const https = require('https');

// login to Sina Weibo, open someone's page
// url would be `http://weibo.com/${UID}?topnav=1&wvr=6&topsug=1&is_all=1`
// the ${UID} part is the UID, should be a number or a custom string
const UID = '3669102477';

// how to get your cookie
// 1. open `http://photo.weibo.com/`
// 2. open DevTools (press 'F12' on Windows or 'option+command+i' on Mac, make sure you are not using old IEs)
// 3. select 'Network' tab, in Filter choose 'XHR', then reload the page
// 4. there will be one or more links shown in the left panel, choose one
// 5. in the right panel `Headers` tab, you will see a parameter named 'Cookie'
// 6. copy and paste it below as a string
const COOKIE = 'login_sid_t=6b0b7106a17dc2c8fe76524abc7e35ca; cross_origin_proto=SSL; _ga=GA1.2.1822868244.1603556905; _gid=GA1.2.1795104734.1603556905; WBStorage=8daec78e6a891122|undefined; _s_tentry=-; Apache=4784642560976.482.1603556908916; SINAGLOBAL=4784642560976.482.1603556908916; ULV=1603556908929:1:1:1:4784642560976.482.1603556908916:; lang=en-us; UOR=,,www.google.com; WBtopGlobal_register_version=2020102500; wvr=6; wb_view_log_6041001022=1536*8641.25; SSOLoginState=1603557762; SUHB=0wnluCuRgxAi-n; SUB=_2A25ykCnJDeRhGeBO71MR8C_MyT6IHXVR5BwBrDV8PUJbmtAfLRHCkW9NShJ5dxnG41Uc2kI86BvUDcFpt1Xtfb8g; SUBP=0033WrSXqPxfM725Ws9jqgMF55529P9D9W5aBpo2QhVuOLYJxep-p6bL5NHD95QcehBpeh5pehzEWs4DqcjMi--NiK.Xi-2Ri--ciKnRi-zNSo5XeK57eK5Eentt; ALF=1635093784; webim_unReadCount=%7B%22time%22%3A1603557897013%2C%22dm_pub_total%22%3A0%2C%22chat_group_client%22%3A0%2C%22chat_group_notice%22%3A0%2C%22allcountNum%22%3A0%2C%22msgbox%22%3A0%7D';

// the quality of images you want to download
// there are 5 options
// 'thumb150' stands for 150 * 150
// 'thumb300' stands for 300 * 300
// 'mw690' stands for 690 * x
// 'mw1024' stands for 1024 * x
// 'large' stands for original image

// note: original image will be used when it's
// low dimension and not large enough to fit the given size
const Quality = 'large';

// max download count in the same time
// prefer less than 10
const Download_Max_Count = 10;

// if download was too slow
// which means it costs more than this time (milliseconds)
// will restart downloading
const Download_Timeout = 10000;


// check if there was `images` folder,
// if not, create it
try {
    fs.statSync('./images');
} catch (e) {
    fs.mkdirSync('./images');
}

// check if there was `images/UID` folder,
// if not, create it
try {
    fs.statSync('./images/' + UID);
} catch (e) {
    fs.mkdirSync('./images/' + UID);
}

let imageList, imageTotalList;
let currentPage = 1;
const countPerPage = 20;
let saveFailedCount = 0;

// current image index in imageList
let currentIndex = -1;
// current downloading image count
let downloadingCount = 0;

const downloadHelper = (newPage = false) => {
    // called by getPage
    if (newPage) {
        currentIndex = -1;
    }

    currentIndex++;
    // current page download finish
    if (currentIndex >= imageList.length || downloadingCount >= Download_Max_Count) return;

    downloadingCount++;
    downloadImage(imageList[currentIndex]);
};

const nextImage = () => {
    downloadingCount--;

    if (downloadingCount === 0 && currentIndex >= imageList.length - 1) {
        currentPage++;
        getPage(currentPage);
    } else {
        downloadHelper();
    }
};

const downloadImage = (image, count = 0) => {
    if (count >= 5) {
        console.warn(`try downloading file: ${image.name} more than 5 times, skip it`);
        nextImage();
        return;
    }

    try {
        // check if image already exists
        fs.statSync(`./images/${UID}/${image.name}`);

        console.info(`file already exists, skip image: ${image.name}`);
        nextImage();
    } catch (e) {
        console.log(`start downloading image: ${image.name}`);

        const request = https.get(image.url, res => {
            let imgData = '';

            res.setEncoding('binary');

            res.on('data', chunk => {
                imgData += chunk;
            }).on('end', () => {
                try {
                    fs.writeFileSync(`./images/${UID}/${image.name}`, imgData, 'binary');
                    console.log(`download complete: ${image.name}`);
                } catch (e) {
                    saveFailedCount++;
                    console.error(`save image failed: ${image.name}`);
                } finally {
                    nextImage();
                }
            });
        });

        request.setTimeout(Download_Timeout, () => {
            // retry
            console.warn(`download timeout, start retry : ${image.name}`);
            downloadImage(image, count + 1);
        });
    }
};

const getPage = page => {
    const ids = imageTotalList.slice((page - 1) * countPerPage, page * countPerPage).join(',');

    // download finish
    if (!ids) {
        console.log(`----- download finish, save failed ${saveFailedCount} -----`);
        return;
    }

    superAgent
        .get('https://photo.weibo.com/photos/get_multiple')
        .set('Cookie', COOKIE)
        .query({uid: UID, ids, type: 3, __rnd: Date.now()})
        .timeout({
            response: 5000,
            deadline: 10000
        })
        .end((err, res) => {
            if (err) {
                console.error(`----- page loading failed id: ${page} -----`);
                console.warn(`----- try reload -----`);
                getPage(page);
            } else {
                console.log(`----- page loaded id: ${page} -----`);

                const data = res.body.data;
                imageList = [];

                for (let i in data) {
                    if (data.hasOwnProperty(i)) {
                        // data[i] could be null sometimes
                        if (!data[i]) {
                            continue;
                        }

                        // slice(0, -2) to clear the last two '\u200'
                        // handle caption with link, remove it
                        // handle caption with enter, change it into space
                        // handle caption with illegal character which can't be used in file name, remove it
                        // handle caption too long, use first 50 characters
                        // handle multiple images with the same caption, add last two number of photo_id
                        imageList.push({
                            name: data[i].caption_render.slice(0, -2).replace(/https:\/\/.+/, '').replace(/\n/g, ' ').replace(/[\\\/:*?"<>|]/g, '').substr(0, 50) + '_' + (data[i].photo_id % 100) + data[i].pic_name.match(/\.(.+)$/)[0],
                            url: `${data[i].pic_host}/${Quality}/${data[i].pic_name}`
                        });
                    }
                }

                for (let i = 0; i < Download_Max_Count; i++) {
                    downloadHelper(!i);
                }
            }
        });
};

const getImageList = () => {
    console.log('----- load image list -----');
    superAgent
        .get('http://photo.weibo.com/photos/get_photo_ids')
        .set('Cookie', COOKIE)
        .query({
            uid: UID, album_id: 0, type: 3, __rnd: Date.now()
        })
        .timeout({
            response: 5000,
            deadline: 10000
        })
        .end((err, res) => {
            if (err) {
                console.error(`----- load image list failed -----`);
                console.warn(`----- try reload -----`);
                getImageList();
            } else {
                imageTotalList = res.body.data;
                console.info(`----- load image list complete, ${imageTotalList.length} images ready to download -----`);
                getPage(currentPage);
            }
        });
};

if (!UID) {
    console.error('please specify an `UID` and try again');
    return;
}

if (!COOKIE) {
    console.error('please specify `COOKIE` and try again');
    return;
}

getImageList();
