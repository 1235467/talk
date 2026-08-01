import type { TerrainType } from '../types'

export interface LocationMapTheme {
  id: string
  name: string
  description: string
  palette: Record<TerrainType, string>
  road: string
  roadEdge: string
  waterLine: string
  texture: 'city' | 'ink' | 'pastoral' | 'fantasy' | 'tribal' | 'future'
  backgroundUrl?: string
}

const theme = (
  id: string,
  name: string,
  description: string,
  palette: Record<TerrainType, string>,
  road: string,
  roadEdge: string,
  waterLine: string,
  texture: LocationMapTheme['texture'],
  backgroundUrl?: string,
): LocationMapTheme => ({ id, name, description, palette, road, roadEdge, waterLine, texture, backgroundUrl })

export const LOCATION_MAP_THEMES: LocationMapTheme[] = [
  theme('river-city', '现代河城', '清爽城市插画，适合现代日常世界', { river: '#55aee4', grassland: '#86c978', beach: '#ead68e', mountain: '#8fa58c', urban: '#c8d0ce', rural: '#b8cf7c' }, '#f5f1e8', '#aeb8b7', '#bfe7fa', 'city', '/location-themes/river-city.webp'),
  theme('japanese', '日式城镇', '浅色街区、河岸与整齐住宅', { river: '#70b5db', grassland: '#91c982', beach: '#e8d7a5', mountain: '#789776', urban: '#d7d1c8', rural: '#b5c982' }, '#f4eee5', '#b8afa5', '#d6eff8', 'pastoral'),
  theme('american', '美式城市', '开阔道路、网格街区与郊区绿地', { river: '#4f9ed1', grassland: '#82b96d', beach: '#dfc37e', mountain: '#8b927d', urban: '#bbb8ae', rural: '#a9be70' }, '#d9d5ca', '#8f918e', '#bce2f3', 'city'),
  theme('british', '英式城镇', '深绿乡野与砖石街区', { river: '#5b99ba', grassland: '#719b69', beach: '#d3bd8a', mountain: '#727c70', urban: '#aaa39b', rural: '#98a966' }, '#c8bfae', '#7d7770', '#c0dce8', 'pastoral'),
  theme('french', '法式城市', '明亮石材、林荫道路与柔和郊野', { river: '#69add2', grassland: '#8dbf79', beach: '#e5d09b', mountain: '#8b9b88', urban: '#d2c9bb', rural: '#b7c985' }, '#eee5d4', '#aaa096', '#cce9f4', 'city'),
  theme('vienna', '维也纳风格', '中欧石城、庄重街道与城郊田野', { river: '#5d9fc2', grassland: '#83aa72', beach: '#d7c48f', mountain: '#7f8b7d', urban: '#c3b8aa', rural: '#aebc76' }, '#dfd3c1', '#968b80', '#c5e1eb', 'city'),
  theme('medieval', '中世纪欧洲', '羊皮纸色城镇、森林与城堡道路', { river: '#477f9d', grassland: '#738d58', beach: '#c8ae70', mountain: '#6f7165', urban: '#a8967b', rural: '#9ca663' }, '#b39a73', '#665a49', '#8fc1d4', 'fantasy'),
  theme('ancient-china', '古代中式', '青绿山水、城池与古道', { river: '#4f9cac', grassland: '#7da06a', beach: '#d4bd78', mountain: '#667e68', urban: '#b2a486', rural: '#a9b676' }, '#c7b88f', '#756b55', '#a9d9df', 'ink'),
  theme('tribal', '原始部落', '浓郁自然、部落营地与荒野', { river: '#3d8fa4', grassland: '#6e9b54', beach: '#d0aa62', mountain: '#756f5d', urban: '#9b7956', rural: '#9da95d' }, '#9a7854', '#604b38', '#80c5d0', 'tribal'),
  theme('fantasy', '奇幻世界', '高饱和秘境、魔法河流与古代遗迹', { river: '#4c96cf', grassland: '#72b36a', beach: '#e0c47b', mountain: '#817b91', urban: '#b3a6bd', rural: '#a7be69' }, '#d4c18b', '#77668a', '#a7ddff', 'fantasy'),
  theme('cyberpunk', '赛博都市', '深色地形与霓虹城市骨架', { river: '#167f9a', grassland: '#315e54', beach: '#8c7b50', mountain: '#3e4655', urban: '#3d4058', rural: '#506345' }, '#9a6cff', '#1b1c2c', '#35e7ff', 'future'),
]

export const DEFAULT_LOCATION_THEME_ID = 'river-city'

export function getLocationTheme(id?: string) {
  return LOCATION_MAP_THEMES.find((item) => item.id === id) ?? LOCATION_MAP_THEMES[0]
}

export interface LocationIconOption {
  id: string
  label: string
  glyph: string
  category: '通用' | '现代' | '中世纪' | '古代中式' | '自然' | '特殊'
  keywords: string
}

const icon = (id: string, label: string, glyph: string, category: LocationIconOption['category'], keywords = ''): LocationIconOption => ({ id, label, glyph, category, keywords })

export const LOCATION_ICON_OPTIONS: LocationIconOption[] = [
  icon('residence', '住宅', '🏠', '通用', '家 公寓 宅邸'), icon('school', '学校', '🏫', '现代', '学院 教室'), icon('office', '办公楼', '🏢', '现代', '公司 中心'), icon('mall', '商场', '🏬', '现代', '购物 市场'), icon('hospital', '医院', '🏥', '现代', '诊所 医疗'), icon('park', '公园', '🌳', '自然', '树林 草坪'), icon('beach', '海滩', '🏖️', '自然', '海湾 沙滩'), icon('scenic', '山地', '⛰️', '自然', '山峰 景区'), icon('farm', '农场', '🚜', '自然', '农田 牧场'),
  icon('restaurant', '餐厅', '🍽️', '通用', '饭店 酒楼'), icon('cafe', '咖啡店', '☕', '现代', '茶馆 饮品'), icon('hotel', '酒店', '🏨', '现代', '旅馆'), icon('station', '车站', '🚉', '现代', '地铁 火车'), icon('airport', '机场', '✈️', '现代'), icon('harbor', '港口', '⚓', '通用', '码头'), icon('library', '图书馆', '📚', '通用', '书院'), icon('factory', '工厂', '🏭', '现代'), icon('police', '警局', '🚓', '现代'),
  icon('castle', '城堡', '🏰', '中世纪', '王宫 要塞'), icon('tavern', '酒馆', '🍺', '中世纪', '旅店'), icon('smithy', '铁匠铺', '⚒️', '中世纪'), icon('guild', '公会', '🛡️', '中世纪', '冒险者'), icon('temple', '神殿', '⛪', '中世纪', '教堂'), icon('magic', '魔法学院', '🔮', '特殊', '法师 魔法塔'), icon('tower', '瞭望塔', '🗼', '中世纪'), icon('dungeon', '地牢', '🕳️', '中世纪', '洞穴 遗迹'),
  icon('palace-cn', '皇宫', '🏯', '古代中式', '宫殿 王府'), icon('gate-cn', '城门', '⛩️', '古代中式', '牌楼'), icon('inn-cn', '客栈', '🏮', '古代中式', '酒楼 茶馆'), icon('academy-cn', '书院', '📜', '古代中式'), icon('garden-cn', '园林', '🪷', '古代中式'), icon('pagoda-cn', '古塔', '🛕', '古代中式'), icon('bamboo', '竹林', '🎋', '古代中式'),
  icon('tribe', '部落营地', '⛺', '特殊', '帐篷 营地'), icon('totem', '图腾', '🗿', '特殊'), icon('volcano', '火山', '🌋', '自然'), icon('swamp', '沼泽', '🐊', '自然'), icon('space', '太空站', '🛰️', '特殊'), icon('lab', '实验室', '🧪', '特殊'), icon('portal', '传送门', '🌀', '特殊'), icon('shelter', '避难所', '☢️', '特殊'), icon('custom', '自定义', '📍', '通用'),
]

export function getLocationIcon(id?: string) {
  return LOCATION_ICON_OPTIONS.find((item) => item.id === id) ?? LOCATION_ICON_OPTIONS[LOCATION_ICON_OPTIONS.length - 1]
}
