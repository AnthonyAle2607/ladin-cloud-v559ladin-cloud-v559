/**
 * Ciudad de origen en letras latinas. 1688 da la ubicación del proveedor en chino («广州市», «浙江 义乌»); la tienda
 * la muestra a clientes venezolanos, así que se pasa a pinyin («Guangzhou, China»). Si queda algún carácter chino que
 * no está en la tabla, se devuelve vacío: mejor sin origen que un texto que el cliente no puede leer.
 */
const CIUDADES = {
  义乌: 'Yiwu', 金华: 'Jinhua', 永康: 'Yongkang', 杭州: 'Hangzhou', 宁波: 'Ningbo', 温州: 'Wenzhou', 台州: 'Taizhou',
  绍兴: 'Shaoxing', 诸暨: 'Zhuji', 湖州: 'Huzhou', 嘉兴: 'Jiaxing', 慈溪: 'Cixi', 余姚: 'Yuyao', 乐清: 'Yueqing', 瑞安: 'Rui’an',
  广州: 'Guangzhou', 深圳: 'Shenzhen', 东莞: 'Dongguan', 佛山: 'Foshan', 中山: 'Zhongshan', 汕头: 'Shantou', 揭阳: 'Jieyang',
  潮州: 'Chaozhou', 江门: 'Jiangmen', 惠州: 'Huizhou', 珠海: 'Zhuhai', 肇庆: 'Zhaoqing', 清远: 'Qingyuan', 阳江: 'Yangjiang',
  泉州: 'Quanzhou', 厦门: 'Xiamen', 福州: 'Fuzhou', 莆田: 'Putian', 晋江: 'Jinjiang', 石狮: 'Shishi', 漳州: 'Zhangzhou',
  上海: 'Shanghai', 北京: 'Beijing', 天津: 'Tianjin', 重庆: 'Chongqing', 苏州: 'Suzhou', 无锡: 'Wuxi', 常州: 'Changzhou',
  南通: 'Nantong', 南京: 'Nanjing', 扬州: 'Yangzhou', 徐州: 'Xuzhou', 丹阳: 'Danyang', 昆山: 'Kunshan', 青岛: 'Qingdao',
  临沂: 'Linyi', 济南: 'Jinan', 潍坊: 'Weifang', 烟台: 'Yantai', 石家庄: 'Shijiazhuang', 保定: 'Baoding', 白沟: 'Baigou',
  沧州: 'Cangzhou', 邢台: 'Xingtai', 武汉: 'Wuhan', 长沙: 'Changsha', 郑州: 'Zhengzhou', 合肥: 'Hefei', 成都: 'Chengdu',
  南昌: 'Nanchang', 西安: 'Xi’an', 沈阳: 'Shenyang', 大连: 'Dalian', 南宁: 'Nanning', 昆明: 'Kunming',
};
const PROVINCIAS = {
  广东: 'Guangdong', 浙江: 'Zhejiang', 江苏: 'Jiangsu', 福建: 'Fujian', 山东: 'Shandong', 河北: 'Hebei', 河南: 'Henan',
  湖北: 'Hubei', 湖南: 'Hunan', 安徽: 'Anhui', 四川: 'Sichuan', 江西: 'Jiangxi', 广西: 'Guangxi', 辽宁: 'Liaoning',
  陕西: 'Shaanxi', 云南: 'Yunnan', 中国: 'China',
};
const CHINO = /[㐀-鿿]/;

function origenLatino(v) {
  const s = String(v ?? '').trim();
  if (!s || !CHINO.test(s)) return s;
  // Se toma la ciudad más específica (la última que aparece: «金华市义乌市» → Yiwu); la provincia solo si no hay ciudad.
  const ciudad = Object.keys(CIUDADES).filter((k) => s.includes(k)).sort((a, b) => s.lastIndexOf(b) - s.lastIndexOf(a))[0];
  if (ciudad) return `${CIUDADES[ciudad]}, China`;
  const quitar = s.replace(/[省市区县镇]|自治区/g, ' ');
  const provincia = Object.keys(PROVINCIAS).find((k) => k !== '中国' && quitar.includes(k));
  if (provincia) return `${PROVINCIAS[provincia]}, China`;
  const latino = s.replace(/[㐀-鿿]+/g, ' ').replace(/[\s,，、·]+/g, ' ').trim();
  return latino && !CHINO.test(latino) && /[a-z]/i.test(latino) ? `${latino}${/china/i.test(latino) ? '' : ', China'}` : '';
}

module.exports = { origenLatino };
