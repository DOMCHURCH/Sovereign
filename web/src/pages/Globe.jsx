import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import GlobeGL from 'react-globe.gl'
import { api } from '../api'
import RiskBadge from '../components/RiskBadge'
import AlertFeed from '../components/AlertFeed'
import {
  buildConflictsByCountry, getConflictViewColor,
  computeContagionScores, getContagionViewColor,
  clusterConflicts, buildEnrichedTooltip,
  CONFLICT_VIEW_COLORS,
} from '../lib/conflictLayer'

const GEO_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson'

const TIER_COLORS = {
  low:      '#4ade80',  // brighter green
  elevated: '#fbbf24',  // amber
  high:     '#fb923c',  // orange
  severe:   '#f87171',  // red
  none:     '#1e2d3d',  // dark blue-grey (ocean-ish, not pure black)
}

const TIER_ALT = {
  severe:   0.03,
  high:     0.018,
  elevated: 0.008,
  low:      0.003,
  none:     0.001,
}

const TIER_CAP_ALPHA = {
  severe:   0.9,
  high:     0.8,
  elevated: 0.7,
  low:      0.65,
  none:     0.5,
}

const CAPITALS = {
  AFG:{lat:34.5,lng:69.2}, AGO:{lat:-8.8,lng:13.2}, ARE:{lat:24.5,lng:54.4},
  ARG:{lat:-34.6,lng:-58.4}, AUS:{lat:-35.3,lng:149.1}, AZE:{lat:40.4,lng:49.9},
  BGD:{lat:23.7,lng:90.4}, BLR:{lat:53.9,lng:27.6}, BRA:{lat:-15.8,lng:-47.9},
  CAN:{lat:45.4,lng:-75.7}, CHE:{lat:46.9,lng:7.5}, CHL:{lat:-33.5,lng:-70.6},
  CHN:{lat:39.9,lng:116.4}, COL:{lat:4.7,lng:-74.1}, CUB:{lat:23.1,lng:-82.4},
  DEU:{lat:52.5,lng:13.4}, DZA:{lat:36.7,lng:3.0}, EGY:{lat:30.1,lng:31.2},
  ESP:{lat:40.4,lng:-3.7}, ETH:{lat:9.0,lng:38.7}, FRA:{lat:48.9,lng:2.3},
  GBR:{lat:51.5,lng:-0.1}, GHA:{lat:5.6,lng:-0.2}, HKG:{lat:22.3,lng:114.2},
  IDN:{lat:-6.2,lng:106.8}, IND:{lat:28.6,lng:77.2}, IRN:{lat:35.7,lng:51.4},
  IRQ:{lat:33.3,lng:44.4}, ISR:{lat:31.8,lng:35.2}, ITA:{lat:41.9,lng:12.5},
  JOR:{lat:31.9,lng:35.9}, JPN:{lat:35.7,lng:139.7}, KAZ:{lat:51.2,lng:71.5},
  KEN:{lat:-1.3,lng:36.8}, KOR:{lat:37.6,lng:127.0}, KWT:{lat:29.4,lng:47.9},
  LBN:{lat:33.9,lng:35.5}, LBY:{lat:32.9,lng:13.2}, MAR:{lat:34.0,lng:-6.8},
  MEX:{lat:19.4,lng:-99.1}, MMR:{lat:19.7,lng:96.1}, MYS:{lat:3.2,lng:101.7},
  NGA:{lat:9.1,lng:7.2}, NIC:{lat:12.1,lng:-86.3}, NLD:{lat:52.1,lng:4.3},
  NOR:{lat:59.9,lng:10.7}, OMN:{lat:23.6,lng:58.6}, PAK:{lat:33.7,lng:73.1},
  PER:{lat:-12.0,lng:-77.0}, PHL:{lat:14.6,lng:121.0}, POL:{lat:52.2,lng:21.0},
  PRK:{lat:39.0,lng:125.8}, QAT:{lat:25.3,lng:51.5}, RUS:{lat:55.8,lng:37.6},
  SAU:{lat:24.7,lng:46.7}, SDN:{lat:15.6,lng:32.5}, SGP:{lat:1.3,lng:103.8},
  SWE:{lat:59.3,lng:18.1}, SYR:{lat:33.5,lng:36.3}, THA:{lat:13.8,lng:100.5},
  TUR:{lat:39.9,lng:32.9}, TWN:{lat:25.0,lng:121.5}, TZA:{lat:-6.2,lng:35.7},
  UKR:{lat:50.4,lng:30.5}, USA:{lat:38.9,lng:-77.0}, UZB:{lat:41.3,lng:69.3},
  VEN:{lat:10.5,lng:-66.9}, VNM:{lat:21.0,lng:105.8}, YEM:{lat:15.4,lng:44.2},
  ZAF:{lat:-25.7,lng:28.2}, ZWE:{lat:-17.8,lng:31.1},
  RWA:{lat:-1.9,lng:30.1},  SSD:{lat:4.9,lng:31.6},   COD:{lat:-4.3,lng:15.3},
  HTI:{lat:18.5,lng:-72.3}, MLI:{lat:12.6,lng:-8.0},  NER:{lat:13.5,lng:2.1},
  SOM:{lat:2.0,lng:45.3},   MOZ:{lat:-25.9,lng:32.6}, BFA:{lat:12.4,lng:-1.5},
  ARM:{lat:40.2,lng:44.5},
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3),16)
  const g = parseInt(hex.slice(3,5),16)
  const b = parseInt(hex.slice(5,7),16)
  return `rgba(${r},${g},${b},${alpha})`
}

function deltaArrow(delta) {
  if (delta == null) return ''
  if (delta > 1) return `↑ +${delta.toFixed(1)}`
  if (delta < -1) return `↓ ${delta.toFixed(1)}`
  return `→ ${delta.toFixed(1)}`
}

function deltaColor(delta) {
  if (delta == null) return '#64748b'
  if (delta > 5) return '#ef4444'
  if (delta > 1) return '#f97316'
  if (delta < -1) return '#22c55e'
  return '#64748b'
}

// ISO_A3 of -99 means unassigned/disputed — use ADM0_A3 as fallback
function getIso3(feat) {
  const iso = feat?.properties?.ISO_A3
  return (iso && iso !== '-99') ? iso : (feat?.properties?.ADM0_A3 || null)
}

// Point colors & sizes by conflict category (not intensity)
const CAT_COLORS = {
  interstate_war:      '#ef4444',  // red
  terrorist_insurgency:'#f97316',  // orange
  civil_war:           '#a855f7',  // purple
  territorial_dispute: '#fbbf24',  // amber
  gang_crisis:         '#ec4899',  // pink
}
const CAT_LABELS = {
  interstate_war:      'Interstate War',
  terrorist_insurgency:'Terrorist / Insurgency',
  civil_war:           'Civil War',
  territorial_dispute: 'Territorial Dispute',
  gang_crisis:         'Gang / Crime Crisis',
}

const CONFLICT_ALT    = { major: 0.06, significant: 0.04, minor: 0.025 }
const CONFLICT_RADIUS = { major: 1.4,  significant: 0.95, minor: 0.6  }

// Arc colors for interstate wars: [startColor, endColor]
const ARC_COLORS = {
  major:       ['rgba(239,68,68,1)',    'rgba(239,68,68,0.5)'],
  significant: ['rgba(249,115,22,0.95)','rgba(249,115,22,0.4)'],
  minor:       ['rgba(251,191,36,0.9)', 'rgba(251,191,36,0.3)'],
}

// Fallback conflict data shown when the backend is unreachable
const FALLBACK_CONFLICTS = [
  {id:"ukraine",name:"Russia–Ukraine War",lat:49.0,lng:32.0,intensity:"major",category:"interstate_war",attacker_iso3:"RUS",defender_iso3:"UKR",parties:"Russia vs. Ukraine",since:2022,description:"Full-scale invasion across eastern and southern Ukraine.",countries:["UKR","RUS"]},
  {id:"gaza",name:"Israel–Gaza War",lat:31.4,lng:34.3,intensity:"major",category:"interstate_war",attacker_iso3:"ISR",defender_iso3:"ISR",parties:"Israel vs. Hamas",since:2023,description:"Israeli military operations in Gaza following Oct 2023 Hamas attacks.",countries:["ISR"]},
  {id:"sudan",name:"Sudan Civil War",lat:15.5,lng:30.0,intensity:"major",category:"civil_war",parties:"SAF vs. RSF",since:2023,description:"War between Sudanese Armed Forces and Rapid Support Forces.",countries:["SDN"]},
  {id:"myanmar",name:"Myanmar Civil War",lat:20.5,lng:95.5,intensity:"major",category:"civil_war",parties:"Junta vs. resistance",since:2021,description:"Armed resistance against military junta following 2021 coup.",countries:["MMR"]},
  {id:"drc-east",name:"DRC – Rwanda-Backed M23",lat:-1.5,lng:28.8,intensity:"major",category:"interstate_war",attacker_iso3:"RWA",defender_iso3:"COD",parties:"FARDC vs. M23/Rwanda",since:2022,description:"Rwanda-backed M23 rebels in North Kivu.",countries:["COD","RWA"]},
  {id:"yemen-saudi",name:"Yemen – Coalition Strikes",lat:15.2,lng:44.8,intensity:"significant",category:"interstate_war",attacker_iso3:"SAU",defender_iso3:"YEM",parties:"Saudi coalition vs. Houthis",since:2015,description:"Saudi airstrikes and Houthi Red Sea attacks.",countries:["YEM","SAU"]},
  {id:"kashmir",name:"Kashmir – India-Pakistan",lat:34.0,lng:74.5,intensity:"significant",category:"interstate_war",attacker_iso3:"PAK",defender_iso3:"IND",parties:"India vs. Pakistan (LOC)",since:1947,description:"Cross-border tensions. Escalated 2025.",countries:["IND","PAK"]},
  {id:"somalia",name:"Somalia – Al-Shabaab",lat:4.5,lng:44.0,intensity:"significant",category:"terrorist_insurgency",parties:"FGS vs. Al-Shabaab",since:2006,description:"Al-Shabaab controls rural areas.",countries:["SOM"]},
  {id:"sahel-mali",name:"Mali – JNIM Insurgency",lat:17.0,lng:-2.0,intensity:"significant",category:"terrorist_insurgency",parties:"FAMA vs. JNIM",since:2012,description:"Jihadist insurgency across central/northern Mali.",countries:["MLI"]},
  {id:"sahel-burkina",name:"Burkina Faso – Insurgency",lat:12.5,lng:-1.5,intensity:"significant",category:"terrorist_insurgency",parties:"Forces vs. JNIM/ISGS",since:2015,description:"Jihadists control ~40% of territory.",countries:["BFA"]},
  {id:"nigeria-ne",name:"Nigeria – Boko Haram/ISWAP",lat:12.0,lng:13.5,intensity:"significant",category:"terrorist_insurgency",parties:"Nigerian forces vs. ISWAP",since:2009,description:"ISWAP active in Lake Chad Basin.",countries:["NGA"]},
  {id:"afghanistan",name:"Afghanistan – IS-K",lat:33.5,lng:66.0,intensity:"significant",category:"terrorist_insurgency",parties:"Taliban vs. IS-K",since:2021,description:"IS-K attacks on Taliban and civilians.",countries:["AFG"]},
  {id:"pakistan-ttp",name:"Pakistan – TTP",lat:33.0,lng:70.0,intensity:"significant",category:"terrorist_insurgency",parties:"Pakistan Army vs. TTP",since:2007,description:"Tehrik-i-Taliban attacks across KP.",countries:["PAK"]},
  {id:"ethiopia-amhara",name:"Ethiopia – Amhara Conflict",lat:11.5,lng:38.0,intensity:"significant",category:"civil_war",parties:"ENDF vs. FANO",since:2023,description:"Conflict between Ethiopian forces and Amhara militias.",countries:["ETH"]},
  {id:"haiti",name:"Haiti – Gang Crisis",lat:18.8,lng:-72.3,intensity:"significant",category:"gang_crisis",parties:"MSS vs. gangs",since:2021,description:"Armed gangs control Port-au-Prince.",countries:["HTI"]},
  {id:"south-china-sea",name:"South China Sea",lat:13.0,lng:115.0,intensity:"minor",category:"interstate_war",attacker_iso3:"CHN",defender_iso3:"PHL",parties:"China vs. Philippines",since:1970,description:"Chinese coast guard confrontations near Spratly Islands.",countries:["CHN","PHL"]},
  {id:"taiwan-strait",name:"Taiwan Strait",lat:23.5,lng:119.5,intensity:"minor",category:"interstate_war",attacker_iso3:"CHN",defender_iso3:"TWN",parties:"PRC vs. Taiwan",since:1949,description:"PLA exercises; US naval presence.",countries:["CHN","TWN"]},
  {id:"westbank",name:"West Bank Violence",lat:31.9,lng:35.2,intensity:"significant",category:"territorial_dispute",parties:"Israeli forces vs. militants",since:2022,description:"Raids, settler violence, militant attacks.",countries:["ISR"]},
]

// Fallback country risk data — shown when the backend API is unreachable.
// Scores are curated estimates; live API values override these on connection.
const FALLBACK_COUNTRIES = [
  // Severe
  {iso3:"SYR",name:"Syria",region:"Middle East",sovereign_risk_score:91,risk_tier:"severe",risk_delta_7d:0.4,top_risk_drivers:["civil war","sanctions exposure","governance deficit"],is_primary_sanctions_target:true},
  {iso3:"SDN",name:"Sudan",region:"Africa",sovereign_risk_score:89,risk_tier:"severe",risk_delta_7d:1.2,top_risk_drivers:["civil war","macro stress","political instability"],is_primary_sanctions_target:false},
  {iso3:"YEM",name:"Yemen",region:"Middle East",sovereign_risk_score:88,risk_tier:"severe",risk_delta_7d:0.1,top_risk_drivers:["military conflict","macro stress","governance deficit"],is_primary_sanctions_target:false},
  {iso3:"AFG",name:"Afghanistan",region:"Asia",sovereign_risk_score:87,risk_tier:"severe",risk_delta_7d:-0.2,top_risk_drivers:["political instability","sanctions exposure","governance deficit"],is_primary_sanctions_target:true},
  {iso3:"SOM",name:"Somalia",region:"Africa",sovereign_risk_score:86,risk_tier:"severe",risk_delta_7d:0.3,top_risk_drivers:["terrorism","governance deficit","macro stress"],is_primary_sanctions_target:false},
  {iso3:"PRK",name:"North Korea",region:"Asia",sovereign_risk_score:85,risk_tier:"severe",risk_delta_7d:0.5,top_risk_drivers:["sanctions exposure","political instability","governance deficit"],is_primary_sanctions_target:true},
  {iso3:"MMR",name:"Myanmar",region:"Asia",sovereign_risk_score:84,risk_tier:"severe",risk_delta_7d:0.8,top_risk_drivers:["civil war","political instability","sanctions exposure"],is_primary_sanctions_target:true},
  {iso3:"HTI",name:"Haiti",region:"Americas",sovereign_risk_score:83,risk_tier:"severe",risk_delta_7d:1.5,top_risk_drivers:["gang crisis","governance deficit","macro stress"],is_primary_sanctions_target:false},
  {iso3:"SSD",name:"South Sudan",region:"Africa",sovereign_risk_score:81,risk_tier:"severe",risk_delta_7d:0.2,top_risk_drivers:["political instability","civil war","governance deficit"],is_primary_sanctions_target:false},
  {iso3:"CAF",name:"Central African Republic",region:"Africa",sovereign_risk_score:80,risk_tier:"severe",risk_delta_7d:0.0,top_risk_drivers:["civil war","governance deficit","macro stress"],is_primary_sanctions_target:false},
  {iso3:"LBY",name:"Libya",region:"Africa",sovereign_risk_score:78,risk_tier:"severe",risk_delta_7d:-0.3,top_risk_drivers:["political instability","civil war","governance deficit"],is_primary_sanctions_target:false},
  {iso3:"MLI",name:"Mali",region:"Africa",sovereign_risk_score:77,risk_tier:"severe",risk_delta_7d:0.6,top_risk_drivers:["terrorism","political instability","governance deficit"],is_primary_sanctions_target:false},
  {iso3:"BFA",name:"Burkina Faso",region:"Africa",sovereign_risk_score:76,risk_tier:"severe",risk_delta_7d:0.9,top_risk_drivers:["terrorism","political instability","governance deficit"],is_primary_sanctions_target:false},
  // High
  {iso3:"UKR",name:"Ukraine",region:"Europe",sovereign_risk_score:74,risk_tier:"high",risk_delta_7d:0.3,top_risk_drivers:["military conflict","macro stress","market stress"],is_primary_sanctions_target:false},
  {iso3:"IRN",name:"Iran",region:"Middle East",sovereign_risk_score:73,risk_tier:"high",risk_delta_7d:0.4,top_risk_drivers:["sanctions exposure","political instability","governance deficit"],is_primary_sanctions_target:true},
  {iso3:"RUS",name:"Russia",region:"Europe",sovereign_risk_score:71,risk_tier:"high",risk_delta_7d:0.2,top_risk_drivers:["sanctions exposure","market stress","political instability"],is_primary_sanctions_target:true},
  {iso3:"NER",name:"Niger",region:"Africa",sovereign_risk_score:70,risk_tier:"high",risk_delta_7d:0.7,top_risk_drivers:["political instability","terrorism","governance deficit"],is_primary_sanctions_target:false},
  {iso3:"COD",name:"DR Congo",region:"Africa",sovereign_risk_score:69,risk_tier:"high",risk_delta_7d:1.1,top_risk_drivers:["civil war","governance deficit","macro stress"],is_primary_sanctions_target:false},
  {iso3:"IRQ",name:"Iraq",region:"Middle East",sovereign_risk_score:67,risk_tier:"high",risk_delta_7d:0.1,top_risk_drivers:["terrorism","political instability","governance deficit"],is_primary_sanctions_target:false},
  {iso3:"VEN",name:"Venezuela",region:"Americas",sovereign_risk_score:66,risk_tier:"high",risk_delta_7d:-0.2,top_risk_drivers:["macro stress","sanctions exposure","political instability"],is_primary_sanctions_target:true},
  {iso3:"ETH",name:"Ethiopia",region:"Africa",sovereign_risk_score:65,risk_tier:"high",risk_delta_7d:0.5,top_risk_drivers:["civil war","macro stress","political instability"],is_primary_sanctions_target:false},
  {iso3:"NGA",name:"Nigeria",region:"Africa",sovereign_risk_score:63,risk_tier:"high",risk_delta_7d:0.3,top_risk_drivers:["terrorism","macro stress","political instability"],is_primary_sanctions_target:false},
  {iso3:"MOZ",name:"Mozambique",region:"Africa",sovereign_risk_score:62,risk_tier:"high",risk_delta_7d:0.4,top_risk_drivers:["terrorism","macro stress","governance deficit"],is_primary_sanctions_target:false},
  {iso3:"PAK",name:"Pakistan",region:"Asia",sovereign_risk_score:61,risk_tier:"high",risk_delta_7d:0.2,top_risk_drivers:["terrorism","macro stress","political instability"],is_primary_sanctions_target:false},
  {iso3:"LBN",name:"Lebanon",region:"Middle East",sovereign_risk_score:60,risk_tier:"high",risk_delta_7d:-0.1,top_risk_drivers:["macro stress","political instability","market stress"],is_primary_sanctions_target:false},
  {iso3:"ZWE",name:"Zimbabwe",region:"Africa",sovereign_risk_score:58,risk_tier:"high",risk_delta_7d:0.0,top_risk_drivers:["macro stress","governance deficit","sanctions exposure"],is_primary_sanctions_target:false},
  {iso3:"COL",name:"Colombia",region:"Americas",sovereign_risk_score:56,risk_tier:"high",risk_delta_7d:0.2,top_risk_drivers:["terrorism","political instability","macro stress"],is_primary_sanctions_target:false},
  // Elevated
  {iso3:"ISR",name:"Israel",region:"Middle East",sovereign_risk_score:54,risk_tier:"elevated",risk_delta_7d:0.8,top_risk_drivers:["military conflict","market stress","political instability"],is_primary_sanctions_target:false},
  {iso3:"CHN",name:"China",region:"Asia",sovereign_risk_score:52,risk_tier:"elevated",risk_delta_7d:0.1,top_risk_drivers:["geopolitical tension","market stress","political instability"],is_primary_sanctions_target:false},
  {iso3:"EGY",name:"Egypt",region:"Africa",sovereign_risk_score:51,risk_tier:"elevated",risk_delta_7d:0.2,top_risk_drivers:["macro stress","political instability","governance deficit"],is_primary_sanctions_target:false},
  {iso3:"TUR",name:"Turkey",region:"Europe",sovereign_risk_score:50,risk_tier:"elevated",risk_delta_7d:0.3,top_risk_drivers:["macro stress","political instability","market stress"],is_primary_sanctions_target:false},
  {iso3:"BLR",name:"Belarus",region:"Europe",sovereign_risk_score:49,risk_tier:"elevated",risk_delta_7d:0.1,top_risk_drivers:["sanctions exposure","political instability","governance deficit"],is_primary_sanctions_target:true},
  {iso3:"BGD",name:"Bangladesh",region:"Asia",sovereign_risk_score:47,risk_tier:"elevated",risk_delta_7d:0.4,top_risk_drivers:["political instability","macro stress","governance deficit"],is_primary_sanctions_target:false},
  {iso3:"KAZ",name:"Kazakhstan",region:"Asia",sovereign_risk_score:45,risk_tier:"elevated",risk_delta_7d:0.0,top_risk_drivers:["political instability","governance deficit","macro stress"],is_primary_sanctions_target:false},
  {iso3:"MEX",name:"Mexico",region:"Americas",sovereign_risk_score:44,risk_tier:"elevated",risk_delta_7d:0.2,top_risk_drivers:["gang crisis","political instability","macro stress"],is_primary_sanctions_target:false},
  {iso3:"ARG",name:"Argentina",region:"Americas",sovereign_risk_score:43,risk_tier:"elevated",risk_delta_7d:-0.3,top_risk_drivers:["macro stress","market stress","political instability"],is_primary_sanctions_target:false},
  {iso3:"IND",name:"India",region:"Asia",sovereign_risk_score:42,risk_tier:"elevated",risk_delta_7d:0.1,top_risk_drivers:["geopolitical tension","political instability","macro stress"],is_primary_sanctions_target:false},
  {iso3:"BRA",name:"Brazil",region:"Americas",sovereign_risk_score:41,risk_tier:"elevated",risk_delta_7d:0.0,top_risk_drivers:["macro stress","political instability","market stress"],is_primary_sanctions_target:false},
  {iso3:"SAU",name:"Saudi Arabia",region:"Middle East",sovereign_risk_score:40,risk_tier:"elevated",risk_delta_7d:0.1,top_risk_drivers:["geopolitical tension","political instability","governance deficit"],is_primary_sanctions_target:false},
  {iso3:"IDN",name:"Indonesia",region:"Asia",sovereign_risk_score:38,risk_tier:"elevated",risk_delta_7d:0.0,top_risk_drivers:["macro stress","political instability","governance deficit"],is_primary_sanctions_target:false},
  {iso3:"MAR",name:"Morocco",region:"Africa",sovereign_risk_score:37,risk_tier:"elevated",risk_delta_7d:0.1,top_risk_drivers:["political instability","macro stress","governance deficit"],is_primary_sanctions_target:false},
  {iso3:"THA",name:"Thailand",region:"Asia",sovereign_risk_score:36,risk_tier:"elevated",risk_delta_7d:0.0,top_risk_drivers:["political instability","macro stress","governance deficit"],is_primary_sanctions_target:false},
  // Low
  {iso3:"USA",name:"United States",region:"Americas",sovereign_risk_score:28,risk_tier:"low",risk_delta_7d:0.1,top_risk_drivers:["market stress","political instability"],is_primary_sanctions_target:false},
  {iso3:"POL",name:"Poland",region:"Europe",sovereign_risk_score:25,risk_tier:"low",risk_delta_7d:0.0,top_risk_drivers:["geopolitical tension","macro stress"],is_primary_sanctions_target:false},
  {iso3:"KOR",name:"South Korea",region:"Asia",sovereign_risk_score:24,risk_tier:"low",risk_delta_7d:0.0,top_risk_drivers:["geopolitical tension","market stress"],is_primary_sanctions_target:false},
  {iso3:"FRA",name:"France",region:"Europe",sovereign_risk_score:22,risk_tier:"low",risk_delta_7d:0.0,top_risk_drivers:["political instability","macro stress"],is_primary_sanctions_target:false},
  {iso3:"ESP",name:"Spain",region:"Europe",sovereign_risk_score:21,risk_tier:"low",risk_delta_7d:0.0,top_risk_drivers:["macro stress","political instability"],is_primary_sanctions_target:false},
  {iso3:"GBR",name:"United Kingdom",region:"Europe",sovereign_risk_score:20,risk_tier:"low",risk_delta_7d:0.0,top_risk_drivers:["macro stress","political instability"],is_primary_sanctions_target:false},
  {iso3:"ITA",name:"Italy",region:"Europe",sovereign_risk_score:20,risk_tier:"low",risk_delta_7d:0.0,top_risk_drivers:["macro stress","political instability"],is_primary_sanctions_target:false},
  {iso3:"CAN",name:"Canada",region:"Americas",sovereign_risk_score:14,risk_tier:"low",risk_delta_7d:0.0,top_risk_drivers:["macro stress"],is_primary_sanctions_target:false},
  {iso3:"AUS",name:"Australia",region:"Asia",sovereign_risk_score:12,risk_tier:"low",risk_delta_7d:0.0,top_risk_drivers:["macro stress"],is_primary_sanctions_target:false},
  {iso3:"DEU",name:"Germany",region:"Europe",sovereign_risk_score:18,risk_tier:"low",risk_delta_7d:0.0,top_risk_drivers:["macro stress","market stress"],is_primary_sanctions_target:false},
  {iso3:"JPN",name:"Japan",region:"Asia",sovereign_risk_score:15,risk_tier:"low",risk_delta_7d:0.0,top_risk_drivers:["macro stress","geopolitical tension"],is_primary_sanctions_target:false},
  {iso3:"NOR",name:"Norway",region:"Europe",sovereign_risk_score:8,risk_tier:"low",risk_delta_7d:0.0,top_risk_drivers:["macro stress"],is_primary_sanctions_target:false},
  {iso3:"SWE",name:"Sweden",region:"Europe",sovereign_risk_score:9,risk_tier:"low",risk_delta_7d:0.0,top_risk_drivers:["macro stress"],is_primary_sanctions_target:false},
  {iso3:"NLD",name:"Netherlands",region:"Europe",sovereign_risk_score:11,risk_tier:"low",risk_delta_7d:0.0,top_risk_drivers:["macro stress"],is_primary_sanctions_target:false},
  {iso3:"SGP",name:"Singapore",region:"Asia",sovereign_risk_score:10,risk_tier:"low",risk_delta_7d:0.0,top_risk_drivers:["geopolitical tension"],is_primary_sanctions_target:false},
  {iso3:"TWN",name:"Taiwan",region:"Asia",sovereign_risk_score:32,risk_tier:"low",risk_delta_7d:0.2,top_risk_drivers:["geopolitical tension","political instability"],is_primary_sanctions_target:false},
  {iso3:"MYS",name:"Malaysia",region:"Asia",sovereign_risk_score:30,risk_tier:"low",risk_delta_7d:0.0,top_risk_drivers:["macro stress","political instability"],is_primary_sanctions_target:false},
  {iso3:"PHL",name:"Philippines",region:"Asia",sovereign_risk_score:35,risk_tier:"low",risk_delta_7d:0.1,top_risk_drivers:["terrorism","political instability"],is_primary_sanctions_target:false},
  {iso3:"GHA",name:"Ghana",region:"Africa",sovereign_risk_score:34,risk_tier:"low",risk_delta_7d:0.0,top_risk_drivers:["macro stress","governance deficit"],is_primary_sanctions_target:false},
  {iso3:"KEN",name:"Kenya",region:"Africa",sovereign_risk_score:38,risk_tier:"elevated",risk_delta_7d:0.1,top_risk_drivers:["terrorism","macro stress","political instability"],is_primary_sanctions_target:false},
  {iso3:"ZAF",name:"South Africa",region:"Africa",sovereign_risk_score:40,risk_tier:"elevated",risk_delta_7d:0.1,top_risk_drivers:["macro stress","political instability","governance deficit"],is_primary_sanctions_target:false},
  {iso3:"TZA",name:"Tanzania",region:"Africa",sovereign_risk_score:33,risk_tier:"low",risk_delta_7d:0.0,top_risk_drivers:["macro stress","governance deficit"],is_primary_sanctions_target:false},
  {iso3:"VNM",name:"Vietnam",region:"Asia",sovereign_risk_score:32,risk_tier:"low",risk_delta_7d:0.0,top_risk_drivers:["governance deficit","geopolitical tension"],is_primary_sanctions_target:false},
  {iso3:"DZA",name:"Algeria",region:"Africa",sovereign_risk_score:45,risk_tier:"elevated",risk_delta_7d:0.0,top_risk_drivers:["political instability","governance deficit","macro stress"],is_primary_sanctions_target:false},
  {iso3:"RWA",name:"Rwanda",region:"Africa",sovereign_risk_score:50,risk_tier:"elevated",risk_delta_7d:0.5,top_risk_drivers:["military conflict","governance deficit","political instability"],is_primary_sanctions_target:false},
]

// Cache GeoJSON at module level so it survives navigation (no CDN round-trip on remount)
let _geoCache = null

export default function Globe() {
  const [countries, setCountries] = useState([])
  const [alerts, setAlerts] = useState([])
  const [impact, setImpact] = useState(null)
  const [lastRefresh, setLastRefresh] = useState(null)
  const [hovered, setHovered] = useState(null)
  const [geoData, setGeoData] = useState(_geoCache || [])
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768)
  const SIDEBAR_W = isMobile ? 0 : 288
  const [dims, setDims] = useState({ w: window.innerWidth - (window.innerWidth < 768 ? 0 : 288), h: window.innerHeight - 48 })
  const [conflicts, setConflicts] = useState([])
  const [conflictSource, setConflictSource] = useState('curated')
  const [conflictsLoading, setConflictsLoading] = useState(false)
  const [gtiData, setGtiData] = useState([])
  const [marketData, setMarketData] = useState(null)
  const [weatherData, setWeatherData] = useState([])
  const [showWeather, setShowWeather] = useState(true)
  const [viewMode, setViewMode] = useState('risk')   // 'risk' | 'conflict' | 'contagion'
  const [gtiAll, setGtiAll] = useState([])
  const globeRef = useRef(null)
  const navigate = useNavigate()

  // Data fetching
  useEffect(() => {
    api.countries()
      .then(d => { setCountries(d && d.length > 0 ? d : FALLBACK_COUNTRIES); setLastRefresh(new Date()) })
      .catch(() => { setCountries(FALLBACK_COUNTRIES); setLastRefresh(new Date()) })
    api.alerts().then(setAlerts).catch(() => {})
    api.portfolioImpact().then(setImpact).catch(() => {})
    setConflictsLoading(true)
    api.conflicts()
      .then(d => { setConflicts(d && d.length > 0 ? d : FALLBACK_CONFLICTS); setConflictsLoading(false) })
      .catch(() => { setConflicts(FALLBACK_CONFLICTS); setConflictsLoading(false) })
    api.conflictsSource().then(d => setConflictSource(d.source)).catch(() => {})

    api.gti().then(d => { setGtiData(d.slice(0, 8)); setGtiAll(d) }).catch(() => {})
    api.marketSnapshot().then(setMarketData).catch(() => {})
    api.weather().then(setWeatherData).catch(() => {})

    const t = setInterval(() => {
      api.countries().then(d => { setCountries(d && d.length > 0 ? d : FALLBACK_COUNTRIES); setLastRefresh(new Date()) }).catch(() => {})
      api.alerts().then(setAlerts).catch(() => {})
      api.portfolioImpact().then(setImpact).catch(() => {})
      api.gti().then(d => { setGtiData(d.slice(0, 8)); setGtiAll(d) }).catch(() => {})
    }, 60000)
    return () => clearInterval(t)
  }, [])

  // GeoJSON — skip fetch if already cached
  useEffect(() => {
    if (_geoCache) return
    fetch(GEO_URL)
      .then(r => r.json())
      .then(d => {
        _geoCache = d.features || []
        setGeoData(_geoCache)
      })
      .catch(() => {})
  }, [])

  // Responsive dimensions
  useEffect(() => {
    const update = () => {
      const mobile = window.innerWidth < 768
      setIsMobile(mobile)
      setDims({ w: window.innerWidth - (mobile ? 0 : 288), h: window.innerHeight - 48 })
    }
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  // Auto-rotate — use onGlobeReady instead of useEffect([globeRef.current])
  // (refs don't trigger re-renders, so useEffect([ref.current]) silently fails on remount)
  const onGlobeReady = useCallback(() => {
    if (!globeRef.current) return
    const controls = globeRef.current.controls()
    if (!controls) return
    controls.autoRotate = true
    controls.autoRotateSpeed = 0.4
    controls.enableZoom = true
  }, [])

  const byIso3 = useMemo(
    () => Object.fromEntries(countries.map(c => [c.iso3, c])),
    [countries]
  )

  const criticalSet = useMemo(
    () => new Set(alerts.filter(a => a.severity === 'critical' && !a.acknowledged).map(a => a.country_iso3)),
    [alerts]
  )

  const top10 = useMemo(
    () => [...countries]
      .filter(c => c.sovereign_risk_score != null)
      .sort((a, b) => b.sovereign_risk_score - a.sovereign_risk_score)
      .slice(0, 10),
    [countries]
  )

  const alertCounts = useMemo(
    () => alerts.reduce((acc, a) => {
      if (!a.acknowledged) acc[a.severity] = (acc[a.severity] || 0) + 1
      return acc
    }, {}),
    [alerts]
  )

  // ── Conflict layer derived state ─────────────────────────────────────────────
  const gtiByIso3 = useMemo(
    () => Object.fromEntries(gtiAll.map(g => [g.iso3, g])),
    [gtiAll]
  )

  const conflictsByCountry = useMemo(
    () => buildConflictsByCountry(conflicts),
    [conflicts]
  )

  const contagionScores = useMemo(
    () => computeContagionScores(countries, conflicts, gtiByIso3),
    [countries, conflicts, gtiByIso3]
  )

  // In Conflict View, cluster nearby hotspots into merged markers
  const clusteredConflicts = useMemo(() => clusterConflicts(conflicts), [conflicts])

  const activePointsData = useMemo(
    () => viewMode === 'conflict' ? clusteredConflicts : conflicts,
    [viewMode, clusteredConflicts, conflicts]
  )

  // Pulsing rings: severe/high countries + conflict zones + severe weather (cyan)
  const ringsData = useMemo(() => {
    const countryRings = countries
      .filter(c => (c.risk_tier === 'severe' || c.risk_tier === 'high') && CAPITALS[c.iso3])
      .map(c => ({ lat: CAPITALS[c.iso3].lat, lng: CAPITALS[c.iso3].lng, iso3: c.iso3, tier: c.risk_tier, kind: 'country' }))

    const conflictRings = conflicts
      .filter(c => c.intensity === 'major' || c.intensity === 'significant')
      .map(c => ({
        lat: c.lat, lng: c.lng, iso3: c.id, tier: c.intensity, kind: 'conflict',
        color: CAT_COLORS[c.category] || '#ef4444',
      }))

    const weatherRings = showWeather
      ? weatherData
          .filter(w => w.is_severe && CAPITALS[w.iso3])
          .map(w => ({
            lat: CAPITALS[w.iso3].lat,
            lng: CAPITALS[w.iso3].lng,
            iso3: w.iso3,
            kind: 'weather',
            color: '#06b6d4',
          }))
      : []

    // Pulsing amber rings for countries with rapidly escalating tension (delta > 2.5)
    // Only shown for countries not already in the severe/high ring set
    const risingRings = countries
      .filter(c => (c.risk_delta_7d || 0) > 2.5 && CAPITALS[c.iso3]
        && c.risk_tier !== 'severe' && c.risk_tier !== 'high')
      .map(c => ({
        lat: CAPITALS[c.iso3].lat, lng: CAPITALS[c.iso3].lng,
        iso3: c.iso3, kind: 'rising',
      }))

    return [...countryRings, ...conflictRings, ...weatherRings, ...risingRings]
  }, [countries, conflicts, weatherData, showWeather])

  const handleClick = useCallback((feat) => {
    const iso3 = getIso3(feat)
    if (iso3) navigate(`/country/${iso3}`)
  }, [navigate])

  // Clicking a conflict spike navigates to the primary country involved
  const handlePointClick = useCallback((d) => {
    const iso3 = d.defender_iso3 || d.attacker_iso3 || d.countries?.[0]
    if (iso3) navigate(`/country/${iso3}`)
  }, [navigate])

  // Clicking an arc navigates to the defender country
  const handleArcClick = useCallback((d) => {
    const iso3 = d.defender_iso3 || d.attacker_iso3 || d.countries?.[0]
    if (iso3) navigate(`/country/${iso3}`)
  }, [navigate])

  const handleHover = useCallback((feat) => {
    setHovered(feat || null)
    const controls = globeRef.current?.controls()
    if (controls) controls.autoRotate = !feat
  }, [])

  const polygonColor = useCallback((feat) => {
    const iso3 = getIso3(feat)
    const c = iso3 ? byIso3[iso3] : null
    const isHov = hovered && getIso3(hovered) === iso3

    if (viewMode === 'conflict') {
      const color = getConflictViewColor(iso3, conflictsByCountry, c)
      return hexToRgba(color, isHov ? 0.95 : 0.78)
    }
    if (viewMode === 'contagion') {
      const color = getContagionViewColor(iso3, contagionScores)
      return hexToRgba(color, isHov ? 0.95 : 0.82)
    }
    // Risk view (default)
    const tier = c?.risk_tier || 'none'
    const color = TIER_COLORS[tier] || TIER_COLORS.none
    return hexToRgba(color, isHov ? 0.95 : (TIER_CAP_ALPHA[tier] ?? 0.5))
  }, [byIso3, hovered, viewMode, conflictsByCountry, contagionScores])

  const polygonSideColor = useCallback((feat) => {
    const iso3 = getIso3(feat)
    const c = iso3 ? byIso3[iso3] : null
    const tier = c?.risk_tier || 'none'
    return hexToRgba(TIER_COLORS[tier] || TIER_COLORS.none, 0.3)
  }, [byIso3])

  const polygonAlt = useCallback((feat) => {
    const iso3 = getIso3(feat)
    const c = iso3 ? byIso3[iso3] : null
    const tier = c?.risk_tier || 'none'
    return TIER_ALT[tier] ?? TIER_ALT.none
  }, [byIso3])

  const polygonLabel = useCallback((feat) => {
    const iso3 = getIso3(feat)
    const c = iso3 ? byIso3[iso3] : null
    if (!c) return ''
    return buildEnrichedTooltip(
      c,
      conflictsByCountry[iso3] || [],
      gtiByIso3[iso3] || null,
      alerts.filter(a => a.country_iso3 === iso3 && !a.acknowledged),
    )
  }, [byIso3, conflictsByCountry, gtiByIso3, alerts])

  // Stable stroke color — must not be inline arrow or it recreates every render
  const polygonStroke = useCallback(() => 'rgba(148,163,184,0.15)', [])

  const refreshConflicts = useCallback(() => {
    setConflictsLoading(true)
    api.conflicts()
      .then(d => { setConflicts(d && d.length > 0 ? d : FALLBACK_CONFLICTS); setConflictsLoading(false) })
      .catch(() => { setConflicts(FALLBACK_CONFLICTS); setConflictsLoading(false) })
    api.conflictsSource().then(d => setConflictSource(d.source)).catch(() => {})
  }, [])

  const conflictColor  = useCallback(d => CAT_COLORS[d.category] || '#ffd700', [])
  const conflictAlt    = useCallback(d => CONFLICT_ALT[d.intensity]    || 0.03, [])
  const conflictRadius = useCallback(d => CONFLICT_RADIUS[d.intensity] || 0.3, [])

  const conflictLabel = useCallback(d => {
    const color = CAT_COLORS[d.category] || '#ffd700'
    const catLabel = CAT_LABELS[d.category] || d.category || d.type
    const intensityIcon = d.intensity === 'major' ? '🔴' : d.intensity === 'significant' ? '🟠' : '🟡'
    const sourceTag = d.source === 'acled' ? '<span style="font-size:9px;padding:1px 5px;border-radius:3px;background:rgba(74,222,128,0.15);color:#4ade80;border:1px solid rgba(74,222,128,0.3)">ACLED LIVE</span>' : d.live ? '<span style="font-size:9px;padding:1px 5px;border-radius:3px;background:rgba(99,102,241,0.15);color:#818cf8;border:1px solid rgba(99,102,241,0.3)">LIVE</span>' : '<span style="font-size:9px;padding:1px 5px;border-radius:3px;background:rgba(100,116,139,0.1);color:#64748b;border:1px solid rgba(100,116,139,0.2)">CURATED</span>'
    const fatalities = d.fatalities != null ? `<div style="color:#f87171;font-size:10px;margin-top:3px">💀 ${d.fatalities.toLocaleString()} fatalities (7d)</div>` : ''
    return `<div style="background:rgba(7,5,16,0.98);border:1px solid ${color}66;border-radius:10px;padding:12px 15px;font-family:monospace;min-width:220px;max-width:280px;box-shadow:0 6px 32px rgba(0,0,0,0.8),0 0 0 1px ${color}22">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:8px">
        <span style="color:#f8fafc;font-size:14px;font-weight:800;line-height:1.3">${d.name}</span>
        ${sourceTag}
      </div>
      <div style="display:flex;gap:5px;margin-bottom:7px;flex-wrap:wrap;align-items:center">
        <span style="font-size:10px;padding:2px 8px;border-radius:4px;background:${color}25;color:${color};border:1px solid ${color}55;text-transform:uppercase;font-weight:700;letter-spacing:0.06em">${d.intensity}</span>
        <span style="font-size:10px;padding:2px 8px;border-radius:4px;background:rgba(255,255,255,0.07);color:#94a3b8;border:1px solid rgba(255,255,255,0.12)">${catLabel}</span>
      </div>
      <div style="color:#cbd5e1;font-size:11px;margin-bottom:5px;font-weight:600">⚔️ ${d.parties}</div>
      <div style="color:#64748b;font-size:10px;line-height:1.55;margin-bottom:4px">${d.description}</div>
      ${fatalities}
      <div style="color:#334155;font-size:10px;margin-top:6px;border-top:1px solid rgba(255,255,255,0.06);padding-top:5px">Active since ${d.since}</div>
    </div>`
  }, [])

  // Interstate wars → animated arc lines between attacker and defender capitals
  const arcsData = useMemo(() => {
    return conflicts
      .filter(d => d.category === 'interstate_war' && d.attacker_iso3 && d.defender_iso3
        && CAPITALS[d.attacker_iso3] && CAPITALS[d.defender_iso3]
        && d.attacker_iso3 !== d.defender_iso3)
      .map(d => ({
        ...d,
        startLat: CAPITALS[d.attacker_iso3].lat,
        startLng: CAPITALS[d.attacker_iso3].lng,
        endLat:   CAPITALS[d.defender_iso3].lat,
        endLng:   CAPITALS[d.defender_iso3].lng,
      }))
  }, [conflicts])

  const arcColor    = useCallback(d => ARC_COLORS[d.intensity] || ARC_COLORS.minor, [])
  const arcLabel    = useCallback(d => conflictLabel(d), [conflictLabel])

  const severeWeatherPoints = useMemo(() => {
    if (!showWeather) return []
    return weatherData
      .filter(w => w.is_severe && CAPITALS[w.iso3])
      .map(w => ({
        ...w,
        lat: CAPITALS[w.iso3].lat,
        lng: CAPITALS[w.iso3].lng,
        _type: 'weather',
      }))
  }, [weatherData, showWeather])

  return (
    <div className="flex h-screen overflow-hidden relative" style={{ background: '#070710' }}>
      {/* Mobile sidebar backdrop */}
      {isMobile && sidebarOpen && (
        <div
          className="fixed inset-0 z-30"
          style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)' }}
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Mobile sidebar toggle button */}
      {isMobile && (
        <button
          onClick={() => setSidebarOpen(o => !o)}
          className="absolute top-3 right-3 z-40 flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-mono font-semibold"
          style={{ background: 'rgba(99,102,241,0.18)', border: '1px solid rgba(99,102,241,0.35)', color: '#a78bfa' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
          Intel
        </button>
      )}

      {/* Globe area */}
      <div className="flex-1 relative overflow-hidden">
        <GlobeGL
          ref={globeRef}
          width={dims.w}
          height={dims.h}
          onGlobeReady={onGlobeReady}
          backgroundColor="#070710"
          backgroundImageUrl="//unpkg.com/three-globe/example/img/night-sky.png"
          globeImageUrl="//cdn.jsdelivr.net/npm/three-globe/example/img/earth-night.jpg"
          atmosphereColor="#a78bfa"
          atmosphereAltitude={0.25}
          polygonsData={geoData}
          polygonCapColor={polygonColor}
          polygonSideColor={polygonSideColor}
          polygonStrokeColor={polygonStroke}
          polygonAltitude={polygonAlt}
          polygonLabel={polygonLabel}
          onPolygonClick={handleClick}
          onPolygonHover={handleHover}
          polygonsTransitionDuration={200}
          pointsData={activePointsData}
          pointLat="lat"
          pointLng="lng"
          pointColor={conflictColor}
          pointAltitude={conflictAlt}
          pointRadius={conflictRadius}
          pointLabel={conflictLabel}
          onPointClick={handlePointClick}
          pointsMerge={false}
          pointsTransitionDuration={400}
          arcsData={arcsData}
          arcStartLat="startLat"
          arcStartLng="startLng"
          arcEndLat="endLat"
          arcEndLng="endLng"
          arcColor={arcColor}
          arcAltitude={0.18}
          arcStroke={1.4}
          onArcClick={handleArcClick}
          arcDashLength={0.5}
          arcDashGap={0.15}
          arcDashAnimateTime={1600}
          arcLabel={arcLabel}
          ringsData={ringsData}
          ringColor={r => {
            if (r.kind === 'rising')  return 'rgba(251,191,36,0.55)'  // amber — rapidly escalating GTI
            if (r.kind === 'weather') return '#06b6d4bb'
            if (r.kind === 'conflict') return (r.color || '#ef4444') + 'cc'
            return r.tier === 'severe' ? '#ef444499' : '#f9731666'
          }}
          ringMaxRadius={r => {
            if (r.kind === 'rising')  return 2.5
            if (r.kind === 'weather') return 5
            if (r.kind === 'conflict') return r.tier === 'major' ? 6 : 4
            return r.tier === 'severe' ? 4 : 3
          }}
          ringPropagationSpeed={r => {
            if (r.kind === 'rising')  return 1.4
            if (r.kind === 'weather') return 2
            return r.kind === 'conflict' ? (r.tier === 'major' ? 4 : 2.5) : (r.tier === 'severe' ? 3 : 2)
          }}
          ringRepeatPeriod={r => {
            if (r.kind === 'rising')  return 2400   // slow amber pulse
            if (r.kind === 'weather') return 1200
            return r.kind === 'conflict' ? (r.tier === 'major' ? 700 : 1100) : (r.tier === 'severe' ? 900 : 1400)
          }}
          ringAltitude={0.01}
        />

        {/* ── View mode toggle (top-left) ────────────────────────────────── */}
        <div className="absolute top-3 left-3 z-10 flex rounded-lg overflow-hidden"
             style={{ background: 'rgba(7,7,16,0.88)', border: '1px solid #1e2d3d', backdropFilter: 'blur(10px)' }}>
          {[
            { mode: 'risk',      label: 'Risk' },
            { mode: 'conflict',  label: 'Conflict' },
            { mode: 'contagion', label: 'Contagion' },
          ].map(({ mode, label }, i) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className="px-3 py-1.5 text-xs font-mono font-semibold transition-all duration-200"
              style={{
                background: viewMode === mode ? 'rgba(99,102,241,0.25)' : 'transparent',
                color: viewMode === mode ? '#a78bfa' : '#475569',
                borderRight: i < 2 ? '1px solid #1e2d3d' : 'none',
                letterSpacing: '0.05em',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ── Floating legend (below toggle) ───────────────────────────────── */}
        <div className="absolute left-3 z-10 pointer-events-none" style={{ top: '3.25rem' }}>
          <div className="rounded-lg px-3 py-2.5"
               style={{ background: 'rgba(7,7,16,0.88)', border: '1px solid #1e2d3d', backdropFilter: 'blur(10px)', minWidth: 148 }}>
            <div className="text-xs font-mono text-slate-600 uppercase tracking-widest mb-2" style={{ fontSize: 9, letterSpacing: '0.08em' }}>
              {viewMode === 'risk' ? 'Sovereign Risk' : viewMode === 'conflict' ? 'Conflict Status' : 'Contagion Exposure'}
            </div>

            {viewMode === 'risk' && (
              <div className="space-y-1.5">
                {[['severe', '#f87171', '>75'], ['high', '#fb923c', '55–75'], ['elevated', '#fbbf24', '35–55'], ['low', '#4ade80', '<35']].map(([t, c, r]) => (
                  <div key={t} className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: c, boxShadow: `0 0 4px ${c}66` }} />
                    <span className="font-mono capitalize text-slate-400" style={{ fontSize: 10 }}>{t}</span>
                    <span className="font-mono text-slate-600 ml-auto" style={{ fontSize: 9 }}>{r}</span>
                  </div>
                ))}
                <div className="flex items-center gap-2 pt-1" style={{ borderTop: '1px solid #1e2d3d', marginTop: 4 }}>
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: '#fbbf24', boxShadow: '0 0 4px #fbbf2466' }} />
                  <span className="font-mono text-slate-500" style={{ fontSize: 9 }}>amber ring = rising GTI</span>
                </div>
              </div>
            )}

            {viewMode === 'conflict' && (
              <div className="space-y-1.5">
                {[
                  ['Active War',   CONFLICT_VIEW_COLORS.active_war],
                  ['Insurgency',   CONFLICT_VIEW_COLORS.insurgency],
                  ['Tension',      CONFLICT_VIEW_COLORS.tension],
                  ['Sanctions',    CONFLICT_VIEW_COLORS.sanctions],
                  ['Stable',       CONFLICT_VIEW_COLORS.stable],
                ].map(([label, c]) => (
                  <div key={label} className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: c, boxShadow: `0 0 4px ${c}66` }} />
                    <span className="font-mono text-slate-400" style={{ fontSize: 10 }}>{label}</span>
                  </div>
                ))}
                <div className="font-mono text-slate-600 pt-1" style={{ fontSize: 9, borderTop: '1px solid #1e2d3d', marginTop: 4 }}>
                  Hotspots clustered by proximity
                </div>
              </div>
            )}

            {viewMode === 'contagion' && (
              <div className="space-y-1.5">
                {[
                  ['Epicenter',     '#ef4444', '>75'],
                  ['High Exposure', '#f97316', '50–75'],
                  ['Moderate',      '#fbbf24', '25–50'],
                  ['Low Risk',      '#22c55e', '<25'],
                ].map(([label, c, r]) => (
                  <div key={label} className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: c, boxShadow: `0 0 4px ${c}66` }} />
                    <span className="font-mono text-slate-400" style={{ fontSize: 10 }}>{label}</span>
                    <span className="font-mono text-slate-600 ml-auto" style={{ fontSize: 9 }}>{r}</span>
                  </div>
                ))}
                <div className="font-mono text-slate-600 pt-1" style={{ fontSize: 9, borderTop: '1px solid #1e2d3d', marginTop: 4, lineHeight: 1.5 }}>
                  Weighted: conflicts · GTI<br/>· region · sanctions
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Drag hint */}
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 text-xs text-slate-600 font-mono pointer-events-none select-none">
          Drag to rotate · Click country to explore
        </div>

        {/* Bottom status bar */}
        <div className="absolute bottom-0 left-0 right-0 flex items-center gap-3 md:gap-6 px-3 md:px-4 py-2 text-xs font-mono overflow-x-auto"
             style={{ background: 'rgba(7,7,16,0.92)', borderTop: '1px solid #1e1e2e', backdropFilter: 'blur(16px)' }}>
          <span className="text-slate-500">ALERTS:</span>
          {alertCounts.critical > 0 && <span className="text-red-400">🔴 {alertCounts.critical} critical</span>}
          {alertCounts.warning > 0 && <span className="text-yellow-400">⚠️ {alertCounts.warning} warning</span>}
          {alertCounts.watch > 0 && <span className="text-indigo-400">👁 {alertCounts.watch} watch</span>}
          {!alertCounts.critical && !alertCounts.warning && !alertCounts.watch && (
            <span className="text-green-500">No active alerts</span>
          )}
          {severeWeatherPoints.length > 0 && (
            <span className="text-amber-400">⛈️ {severeWeatherPoints.length} severe weather</span>
          )}
          <span className="ml-auto text-slate-500">
            PORTFOLIO EST:{' '}
            <span className={impact?.total_shock_pct < -0.01 ? 'text-red-400' : 'text-green-400'}>
              {impact ? `${(impact.total_shock_pct * 100).toFixed(2)}%` : '—'}
            </span>
          </span>
          <span className="text-slate-600">
            REFRESHED {lastRefresh ? lastRefresh.toLocaleTimeString() : '—'}
          </span>
        </div>
      </div>

      {/* Right sidebar — fixed overlay on mobile, inline on desktop */}
      <div
        className="flex flex-col overflow-hidden overflow-y-auto"
        style={{
          width: isMobile ? '88vw' : '288px',
          maxWidth: isMobile ? '360px' : undefined,
          borderLeft: '1px solid #1e1e2e',
          background: 'linear-gradient(180deg, #0d0d18 0%, #0a0a14 100%)',
          ...(isMobile ? {
            position: 'fixed',
            top: 48,
            right: 0,
            bottom: 0,
            zIndex: 35,
            transform: sidebarOpen ? 'translateX(0)' : 'translateX(100%)',
            transition: 'transform 0.28s cubic-bezier(0.4,0,0.2,1)',
            boxShadow: '-8px 0 40px rgba(0,0,0,0.6)',
          } : {}),
        }}>
        {/* Section header: Top Risk Countries */}
        <div className="px-4 pt-4 pb-2 border-b" style={{ borderColor: '#1e1e2e' }}>
          <h2 className="text-xs font-mono text-slate-500 tracking-widest uppercase flex items-center gap-2">
            <span className="w-2 h-2 rounded-full inline-block shrink-0" style={{ background: '#f87171' }} />
            Top Risk Countries
          </h2>
        </div>

        <div className="flex-1 overflow-y-auto">
          {top10.map((c, i) => {
            const score = c.sovereign_risk_score ?? 0
            const barColor = TIER_COLORS[c.risk_tier] || '#64748b'
            return (
              <div
                key={c.iso3}
                className="flex items-center gap-3 px-4 py-2.5 cursor-pointer border-b hover:bg-white/5 transition-colors"
                style={{
                  borderColor: '#1e1e2e',
                  borderLeft: `3px solid ${barColor}40`,
                }}
                onClick={() => navigate(`/country/${c.iso3}`)}
              >
                <span className="text-slate-600 font-mono text-xs w-4">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-200 text-sm truncate font-medium">{c.name}</span>
                    {criticalSet.has(c.iso3) && <span className="text-red-400 text-xs">🔴</span>}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <RiskBadge tier={c.risk_tier} size="xs" />
                    <span className="text-xs font-mono" style={{ color: deltaColor(c.risk_delta_7d) }}>
                      {deltaArrow(c.risk_delta_7d)}
                    </span>
                  </div>
                  {/* Score bar */}
                  <div className="mt-1.5 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${Math.min(score, 100)}%`,
                        background: `linear-gradient(90deg, ${barColor}99, ${barColor})`,
                      }}
                    />
                  </div>
                </div>
                <span className="font-mono text-sm font-bold shrink-0"
                      style={{ color: TIER_COLORS[c.risk_tier] || '#64748b' }}>
                  {c.sovereign_risk_score?.toFixed(0)}
                </span>
              </div>
            )
          })}
        </div>

        {/* GTI — Geopolitical Tension Index */}
        {gtiData.length > 0 && (
          <div className="border-t" style={{ borderColor: '#1e1e2e' }}>
            <div className="px-4 pt-3 pb-1">
              <h2 className="text-xs font-mono text-slate-500 tracking-widest uppercase flex items-center gap-2">
                <span className="w-2 h-2 rounded-full inline-block shrink-0" style={{ background: '#f97316' }} />
                Tension Index (GTI)
              </h2>
            </div>
            <div className="px-4 pb-3 space-y-1.5">
              {gtiData.map(d => {
                const gtiColor = d.gti >= 75 ? '#ef4444' : d.gti >= 55 ? '#f97316' : d.gti >= 35 ? '#fbbf24' : '#4ade80'
                return (
                  <div key={d.iso3} className="flex items-center gap-2 cursor-pointer hover:bg-white/5 rounded px-1 -mx-1 py-0.5 transition-colors"
                       onClick={() => navigate(`/country/${d.iso3}`)}>
                    <span className="font-mono text-xs text-slate-500 w-8 shrink-0">{d.iso3}</span>
                    <div className="flex-1 h-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
                      <div className="h-1.5 rounded-full transition-all"
                           style={{ width: `${d.gti}%`, background: `linear-gradient(90deg, ${gtiColor}88, ${gtiColor})` }} />
                    </div>
                    <span className="font-mono text-xs shrink-0" style={{ color: gtiColor }}>{d.gti.toFixed(0)}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Market ticker — top movers */}
        {marketData && Object.keys(marketData.equities || {}).length > 0 && (
          <div className="border-t px-4 py-2.5 overflow-x-auto" style={{ borderColor: '#1e1e2e' }}>
            <div className="flex gap-3 text-xs font-mono whitespace-nowrap">
              {Object.entries(marketData.equities).slice(0, 6).map(([ticker, d]) => (
                <span key={ticker} className="flex items-center gap-1">
                  <span className="text-slate-500">{ticker}</span>
                  <span style={{ color: d.change_pct >= 0 ? '#4ade80' : '#f87171' }}>
                    {d.change_pct >= 0 ? '+' : ''}{d.change_pct.toFixed(1)}%
                  </span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Section header: Live Alerts */}
        <div className="border-t" style={{ borderColor: '#1e1e2e' }}>
          <div className="px-4 pt-3 pb-1">
            <h2 className="text-xs font-mono text-slate-500 tracking-widest uppercase flex items-center gap-2">
              <span className="w-2 h-2 rounded-full inline-block shrink-0" style={{ background: '#fbbf24' }} />
              Live Alerts
            </h2>
          </div>
          <div className="px-2 pb-3 max-h-48 overflow-y-auto">
            <AlertFeed limit={5} compact />
          </div>
        </div>

        {/* Legend + conflict toggle */}
        <div className="px-4 py-3 border-t space-y-2.5" style={{ borderColor: '#1e1e2e' }}>
          {/* Risk tier legend */}
          <div className="flex items-center gap-3 text-xs font-mono flex-wrap">
            {[['low', TIER_COLORS.low], ['elevated', TIER_COLORS.elevated], ['high', TIER_COLORS.high], ['severe', TIER_COLORS.severe]].map(([t, c]) => (
              <span key={t} className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full inline-block" style={{ background: c }} />
                <span className="text-slate-500">{t}</span>
              </span>
            ))}
          </div>

          {/* Weather toggle */}
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono text-slate-400 font-semibold">Weather</span>
            <button
              onClick={() => setShowWeather(w => !w)}
              className="text-xs px-2 py-1 rounded font-mono transition-colors"
              style={{
                background: showWeather ? 'rgba(251,191,36,0.15)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${showWeather ? 'rgba(251,191,36,0.3)' : 'rgba(255,255,255,0.08)'}`,
                color: showWeather ? '#fbbf24' : '#64748b',
              }}
            >
              ⛈️ Weather
            </button>
          </div>

          {/* Conflict zones */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-mono">
                <span className="text-slate-400 font-semibold">Conflicts</span>
                {conflicts.length > 0 && <span className="text-slate-600">({conflicts.length})</span>}
              </div>
              <button
                onClick={refreshConflicts}
                disabled={conflictsLoading}
                className="text-slate-600 hover:text-slate-400 transition-colors disabled:opacity-40 text-xs px-1"
                title="Refresh live data"
              >
                {conflictsLoading ? '⟳' : '↺'}
              </button>
            </div>

            {/* Category legend */}
            {conflicts.length > 0 && (
              <div className="space-y-1 pl-0.5">
                {Object.entries(CAT_LABELS).map(([cat, label]) => {
                  const color = CAT_COLORS[cat]
                  const isArc = cat === 'interstate_war'
                  const count = conflicts.filter(c => c.category === cat).length
                  if (!count) return null
                  return (
                    <div key={cat} className="flex items-center gap-2 text-xs font-mono">
                      {isArc ? (
                        <span style={{ width: 14, height: 2, background: `linear-gradient(90deg, ${color}, transparent)`, display: 'inline-block', borderRadius: 1, flexShrink: 0 }} />
                      ) : (
                        <span className="w-2 h-2 rounded-full inline-block shrink-0" style={{ background: color, boxShadow: `0 0 4px ${color}88` }} />
                      )}
                      <span className="text-slate-500 truncate">{label}</span>
                      <span className="text-slate-700 ml-auto shrink-0">{count}</span>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Data source badge */}
            <div className="flex items-center gap-1.5">
              <span
                className="text-xs font-mono px-1.5 py-0.5 rounded"
                style={{
                  background: conflictSource === 'curated' ? 'rgba(100,116,139,0.1)' : 'rgba(74,222,128,0.1)',
                  color: conflictSource === 'curated' ? '#475569' : '#4ade80',
                  border: `1px solid ${conflictSource === 'curated' ? 'rgba(100,116,139,0.2)' : 'rgba(74,222,128,0.25)'}`,
                }}
              >
                {conflictSource === 'valyu' ? '⚡ VALYU LIVE' : conflictSource === 'gdelt' ? '📡 GDELT LIVE' : '📋 CURATED'}
              </span>
              {conflictSource !== 'curated' && (
                <span className="text-xs text-slate-700 font-mono">30m cache</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
