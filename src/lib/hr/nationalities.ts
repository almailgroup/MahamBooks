import { countryOptions } from '@/lib/geo';
import { normalizeDigits } from '@/lib/money';

/**
 * Nationalities as HR systems and spreadsheets write them: country names
 * ("EGYPT", "مصر"), adjectives ("Egyptian", "مصري", "مصرية") and codes
 * ("EG", "EGY"), read into ISO 3166-1 alpha-2 codes.
 */

/** Adjectives and other names of the nationalities common in Kuwait (country names come from Intl). */
const NATIONALITIES: { code: string; alpha3: string; names: string[] }[] = [
  { code: 'KW', alpha3: 'KWT', names: ['Kuwaiti', 'Kuwaitis', 'كويتي'] },
  { code: 'SA', alpha3: 'SAU', names: ['Saudi', 'Saudi Arabian', 'KSA', 'سعودي', 'السعوديه'] },
  {
    code: 'AE',
    alpha3: 'ARE',
    names: ['Emirati', 'UAE', 'U.A.E.', 'Emirates', 'اماراتي', 'الامارات'],
  },
  { code: 'BH', alpha3: 'BHR', names: ['Bahraini', 'بحريني'] },
  { code: 'QA', alpha3: 'QAT', names: ['Qatari', 'قطري'] },
  { code: 'OM', alpha3: 'OMN', names: ['Omani', 'عماني', 'سلطنه عمان'] },
  { code: 'EG', alpha3: 'EGY', names: ['Egyptian', 'مصري'] },
  { code: 'IN', alpha3: 'IND', names: ['Indian', 'هندي'] },
  { code: 'NP', alpha3: 'NPL', names: ['Nepali', 'Nepalese', 'نيبالي'] },
  { code: 'PH', alpha3: 'PHL', names: ['Filipino', 'Filipina', 'Philippine', 'فلبيني', 'فليبيني'] },
  { code: 'PK', alpha3: 'PAK', names: ['Pakistani', 'باكستاني'] },
  {
    code: 'LK',
    alpha3: 'LKA',
    names: ['Sri Lankan', 'Srilankan', 'Srilanka', 'سريلانكي', 'سيريلانكي'],
  },
  {
    code: 'BD',
    alpha3: 'BGD',
    names: ['Bangladeshi', 'Bengali', 'Bangali', 'بنغالي', 'بنجلاديشي', 'بنغلاديشي'],
  },
  { code: 'SY', alpha3: 'SYR', names: ['Syrian', 'سوري'] },
  { code: 'JO', alpha3: 'JOR', names: ['Jordanian', 'اردني'] },
  { code: 'LB', alpha3: 'LBN', names: ['Lebanese', 'لبناني'] },
  { code: 'PS', alpha3: 'PSE', names: ['Palestinian', 'Palestine', 'فلسطيني', 'فلسطين'] },
  { code: 'IQ', alpha3: 'IRQ', names: ['Iraqi', 'عراقي'] },
  { code: 'IR', alpha3: 'IRN', names: ['Iranian', 'Persian', 'ايراني'] },
  { code: 'YE', alpha3: 'YEM', names: ['Yemeni', 'Yemenite', 'يمني'] },
  { code: 'SD', alpha3: 'SDN', names: ['Sudanese', 'سوداني'] },
  { code: 'SS', alpha3: 'SSD', names: ['South Sudanese', 'جنوب سوداني'] },
  { code: 'ET', alpha3: 'ETH', names: ['Ethiopian', 'اثيوبي', 'حبشي'] },
  { code: 'ER', alpha3: 'ERI', names: ['Eritrean', 'اريتري'] },
  { code: 'KE', alpha3: 'KEN', names: ['Kenyan', 'كيني'] },
  { code: 'UG', alpha3: 'UGA', names: ['Ugandan', 'اوغندي'] },
  { code: 'TZ', alpha3: 'TZA', names: ['Tanzanian', 'تنزاني'] },
  { code: 'NG', alpha3: 'NGA', names: ['Nigerian', 'نيجيري'] },
  { code: 'GH', alpha3: 'GHA', names: ['Ghanaian', 'غاني'] },
  { code: 'TD', alpha3: 'TCD', names: ['Chadian', 'تشادي'] },
  { code: 'CM', alpha3: 'CMR', names: ['Cameroonian', 'كاميروني'] },
  { code: 'SN', alpha3: 'SEN', names: ['Senegalese', 'سنغالي'] },
  { code: 'SO', alpha3: 'SOM', names: ['Somali', 'Somalian', 'صومالي'] },
  { code: 'MA', alpha3: 'MAR', names: ['Moroccan', 'مغربي'] },
  { code: 'TN', alpha3: 'TUN', names: ['Tunisian', 'تونسي'] },
  { code: 'DZ', alpha3: 'DZA', names: ['Algerian', 'جزائري'] },
  { code: 'LY', alpha3: 'LBY', names: ['Libyan', 'ليبي'] },
  { code: 'AF', alpha3: 'AFG', names: ['Afghan', 'Afghani', 'افغاني'] },
  { code: 'ID', alpha3: 'IDN', names: ['Indonesian', 'اندونيسي'] },
  { code: 'MM', alpha3: 'MMR', names: ['Burmese', 'Burma', 'Myanmarese', 'بورمي'] },
  { code: 'TH', alpha3: 'THA', names: ['Thai', 'تايلندي'] },
  { code: 'VN', alpha3: 'VNM', names: ['Vietnamese', 'فيتنامي'] },
  { code: 'CN', alpha3: 'CHN', names: ['Chinese', 'صيني'] },
  { code: 'TR', alpha3: 'TUR', names: ['Turkish', 'Turkey', 'Turk', 'تركي'] },
  { code: 'GB', alpha3: 'GBR', names: ['British', 'UK', 'U.K.', 'England', 'English', 'بريطاني'] },
  {
    code: 'US',
    alpha3: 'USA',
    names: ['American', 'USA', 'U.S.A.', 'United States of America', 'امريكي', 'امريكا'],
  },
  { code: 'CA', alpha3: 'CAN', names: ['Canadian', 'كندي'] },
  { code: 'AU', alpha3: 'AUS', names: ['Australian', 'استرالي'] },
  { code: 'FR', alpha3: 'FRA', names: ['French', 'فرنسي'] },
  { code: 'DE', alpha3: 'DEU', names: ['German', 'الماني'] },
  { code: 'RU', alpha3: 'RUS', names: ['Russian', 'روسي'] },
  { code: 'KR', alpha3: 'KOR', names: ['Korean', 'South Korean', 'كوري'] },
  { code: 'BT', alpha3: 'BTN', names: ['Bhutanese', 'بوتاني'] },
  { code: 'MG', alpha3: 'MDG', names: ['Malagasy', 'Madagascan', 'مدغشقري'] },
  { code: 'RW', alpha3: 'RWA', names: ['Rwandan', 'رواندي'] },
  { code: 'BI', alpha3: 'BDI', names: ['Burundian', 'بوروندي'] },
  { code: 'ZW', alpha3: 'ZWE', names: ['Zimbabwean', 'زيمبابوي'] },
  { code: 'SL', alpha3: 'SLE', names: ['Sierra Leonean', 'سيراليوني'] },
  { code: 'CI', alpha3: 'CIV', names: ['Ivorian', 'Ivory Coast', 'Cote d Ivoire', 'ايفواري'] },
  { code: 'BJ', alpha3: 'BEN', names: ['Beninese', 'بنيني'] },
  { code: 'TG', alpha3: 'TGO', names: ['Togolese', 'توغولي'] },
  { code: 'ML', alpha3: 'MLI', names: ['Malian', 'مالي'] },
  { code: 'NE', alpha3: 'NER', names: ['Nigerien', 'النيجر'] },
  { code: 'MR', alpha3: 'MRT', names: ['Mauritanian', 'موريتاني'] },
  { code: 'DJ', alpha3: 'DJI', names: ['Djiboutian', 'جيبوتي'] },
  { code: 'KM', alpha3: 'COM', names: ['Comorian', 'قمري'] },
];

/** Compared without case, Arabic letter forms, diacritics or punctuation. */
export function nationalityKey(text: string): string {
  return normalizeDigits(text)
    .toLowerCase()
    .replace(/[ً-ْٰـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * The forms an Arabic adjective takes: with or without the article, and
 * the feminine (مصري، المصري، مصرية، المصرية).
 */
function arabicForms(key: string): string[] {
  if (!/[؀-ۿ]/.test(key)) return [key];
  const bare = key.startsWith('ال') ? key.slice(2) : key;
  const forms = [key, bare];
  if (bare.endsWith('ي')) forms.push(`${bare}ه`);
  return forms;
}

let lookup: Map<string, string> | null = null;

function table(): Map<string, string> {
  if (lookup) return lookup;
  lookup = new Map();
  const add = (name: string, code: string) => {
    for (const form of arabicForms(nationalityKey(name))) {
      if (form && !lookup!.has(form)) lookup!.set(form, code);
    }
  };
  for (const n of NATIONALITIES) {
    for (const name of n.names) add(name, n.code);
    add(n.alpha3, n.code);
  }
  for (const locale of ['en', 'ar']) {
    for (const option of countryOptions(locale)) {
      add(option.label, option.value);
      // "Myanmar (Burma)" and similar are also written without the brackets.
      const plain = option.label.replace(/\s*\(.*\)\s*/, '');
      if (plain !== option.label) add(plain, option.value);
    }
  }
  return lookup;
}

const CODES = new Set(countryOptions('en').map((o) => o.value));

/**
 * Stateless residents (bedoon) and "non-Kuwaiti" have no country: they must
 * not be read as Kuwaiti because the word appears in them.
 */
const NO_COUNTRY = /\b(bedoon|bidoon|bidun|stateless|non kuwaiti|non)\b|بدون|غير/;

/**
 * The ISO code of a nationality or country written in English or Arabic,
 * or null when it isn't recognised. Empty text gives null too.
 */
export function nationalityCode(text: string): string | null {
  const value = text.trim();
  if (!value) return null;
  if (/^[A-Za-z]{2}$/.test(value) && CODES.has(value.toUpperCase())) return value.toUpperCase();
  const key = nationalityKey(value);
  if (!key || NO_COUNTRY.test(key)) return null;
  const found = table().get(key) ?? (key.startsWith('ال') ? table().get(key.slice(2)) : undefined);
  if (found) return found;
  // "Nationality: Egyptian", "EGYPTIAN NATIONAL", "من الجنسية المصرية".
  const words = key.split(' ');
  for (let size = Math.min(3, words.length); size >= 1; size--) {
    for (let i = 0; i + size <= words.length; i++) {
      const part = words.slice(i, i + size).join(' ');
      if (part.length < 3) continue;
      const code = table().get(part);
      if (code) return code;
    }
  }
  return null;
}
