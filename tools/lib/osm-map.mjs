// Map OpenStreetMap tags to the directory's categories.

import { prettyStreet, formatPhone, cleanUrl, uniq } from './common.mjs';
import { normalizeHours } from '../../assets/js/hours.js';

// key=value -> [category, subcategory]. `null` means "not a consumer business; skip".
const MAP = {
  amenity: {
    restaurant: ['restaurants', 'Restaurant'], fast_food: ['restaurants', 'Fast casual'], food_court: ['restaurants', 'Food court'],
    bar: ['restaurants', 'Bar'], pub: ['restaurants', 'Pub'], biergarten: ['restaurants', 'Beer garden'],
    cafe: ['cafes-treats', 'Coffee shop'], ice_cream: ['cafes-treats', 'Ice cream shop'],
    bank: ['money', 'Bank'], bureau_de_change: ['money', 'Currency exchange'],
    pharmacy: ['health', 'Pharmacy'], doctors: ['health', 'Doctor’s office'], clinic: ['health', 'Medical clinic'],
    dentist: ['dental', 'Dentist'], veterinary: ['pets', 'Veterinarian'],
    fuel: ['auto', 'Gas station'], car_wash: ['auto', 'Car wash'], car_rental: ['auto', 'Car rental'],
    post_office: ['errands', 'Post office'], library: ['community', 'Public library'],
    community_centre: ['community', 'Community center'], social_centre: ['community', 'Community center'], townhall: ['community', 'Government office'],
    theatre: ['arts-fun', 'Theater'], cinema: ['arts-fun', 'Movie theater'], arts_centre: ['arts-fun', 'Arts center'],
    kindergarten: ['kids', 'Preschool'], childcare: ['kids', 'Child care center'], prep_school: ['kids', 'Tutoring & test prep'],
    driving_school: ['kids', 'Driving school'], music_school: ['kids', 'Music school'], language_school: ['kids', 'Language school'],
    dancing_school: ['fitness', 'Dance studio'], dojo: ['fitness', 'Martial arts'],
    nursing_home: ['senior', 'Nursing home'], marketplace: ['groceries', 'Farmers market'], events_venue: ['hotels-events', 'Event venue'],
    school: ['kids', 'Private school'], hospital: ['health', 'Hospital'], college: ['community', 'College'],
    animal_shelter: ['pets', 'Animal shelter'], boat_rental: ['arts-fun', 'Boat & kayak rental'], bicycle_rental: ['arts-fun', 'Bike rental'],
  },
  shop: {
    supermarket: ['groceries', 'Supermarket'], convenience: ['groceries', 'Convenience store'], alcohol: ['groceries', 'Wine & spirits'],
    wine: ['groceries', 'Wine shop'], beverages: ['groceries', 'Beverage store'], deli: ['groceries', 'Deli & specialty foods'],
    butcher: ['groceries', 'Butcher'], seafood: ['groceries', 'Seafood market'], cheese: ['groceries', 'Cheese shop'],
    greengrocer: ['groceries', 'Produce market'], health_food: ['groceries', 'Health food store'], frozen_food: ['groceries', 'Frozen food'],
    bakery: ['cafes-treats', 'Bakery'], pastry: ['cafes-treats', 'Pastry shop'], confectionery: ['cafes-treats', 'Candy & chocolate'],
    chocolate: ['cafes-treats', 'Chocolate shop'], coffee: ['cafes-treats', 'Coffee roaster'], tea: ['cafes-treats', 'Tea shop'],
    ice_cream: ['cafes-treats', 'Ice cream shop'],
    dry_cleaning: ['errands', 'Dry cleaner'], laundry: ['errands', 'Laundromat'], tailor: ['errands', 'Tailor & alterations'],
    shoe_repair: ['errands', 'Shoe repair'], copyshop: ['errands', 'Printing & copies'], storage_rental: ['errands', 'Self storage'],
    mobile_phone: ['shopping', 'Phone store'], electronics: ['shopping', 'Electronics'], computer: ['shopping', 'Computer store'],
    hairdresser: ['beauty', 'Hair salon'], beauty: ['beauty', 'Beauty & skin care'], cosmetics: ['beauty', 'Cosmetics'],
    massage: ['beauty', 'Massage'], perfumery: ['beauty', 'Fragrance'], hairdresser_supply: ['beauty', 'Beauty supply'],
    clothes: ['shopping', 'Clothing'], shoes: ['shopping', 'Shoes'], jewelry: ['shopping', 'Jewelry'], watches: ['shopping', 'Watches'],
    gift: ['shopping', 'Gifts'], florist: ['shopping', 'Florist'], books: ['shopping', 'Bookstore'], toys: ['shopping', 'Toys'],
    sports: ['shopping', 'Sporting goods'], outdoor: ['shopping', 'Outdoor gear'], bicycle: ['shopping', 'Bike shop'],
    furniture: ['shopping', 'Furniture'], houseware: ['shopping', 'Kitchen & home'], bed: ['shopping', 'Mattresses'],
    art: ['shopping', 'Art gallery'], frame: ['shopping', 'Custom framing'], antiques: ['shopping', 'Antiques'],
    second_hand: ['shopping', 'Consignment & resale'], charity: ['shopping', 'Thrift store'], stationery: ['shopping', 'Stationery & cards'],
    variety_store: ['shopping', 'Variety store'], department_store: ['shopping', 'Department store'], mall: ['shopping', 'Shopping mall'],
    music: ['shopping', 'Music store'], musical_instrument: ['shopping', 'Musical instruments'], craft: ['shopping', 'Crafts'],
    fabric: ['shopping', 'Fabric store'], bag: ['shopping', 'Handbags & luggage'], baby_goods: ['shopping', 'Baby store'],
    party: ['shopping', 'Party supplies'], photo: ['shopping', 'Photo store'], nutrition_supplements: ['shopping', 'Vitamins & supplements'],
    tobacco: null, vape: null, e_cigarette: null, cannabis: null, erotic: null, weapons: null, money_lender: null, pawnbroker: null,
    interior_decoration: ['home', 'Interior decor'], carpet: ['home', 'Flooring & rugs'], flooring: ['home', 'Flooring & rugs'],
    window_blind: ['home', 'Window treatments'], curtain: ['home', 'Window treatments'], paint: ['home', 'Paint store'],
    hardware: ['home', 'Hardware store'], doityourself: ['home', 'Home improvement store'], garden_centre: ['home', 'Garden center'],
    locksmith: ['home', 'Locksmith'], kitchen: ['home', 'Kitchen design'], bathroom_furnishing: ['home', 'Bath showroom'],
    lighting: ['home', 'Lighting'], appliance: ['home', 'Appliances'], tiles: ['home', 'Tile'], swimming_pool: ['home', 'Pool supplies'],
    optician: ['eye-care', 'Optician & eyewear'], hearing_aids: ['health', 'Hearing aids'], medical_supply: ['health', 'Medical supplies'],
    chemist: ['health', 'Drugstore'],
    car_repair: ['auto', 'Auto repair'], car_parts: ['auto', 'Auto parts'], car: ['auto', 'Car dealer'], tyres: ['auto', 'Tires'],
    pet: ['pets', 'Pet store'], pet_grooming: ['pets', 'Pet grooming'],
    travel_agency: ['professional', 'Travel agency'], funeral_directors: ['professional', 'Funeral home'],
    fishing: ['shopping', 'Fishing tackle & bait'], surf: ['shopping', 'Surf shop'], wool: ['shopping', 'Yarn shop'],
    esoteric: ['shopping', 'Crystals & metaphysical'], discount: ['shopping', 'Discount store'], trade: ['home', 'Building supply'],
    tattoo: ['beauty', 'Tattoo studio'], boat: ['auto', 'Boat dealer'], hunting: null,
  },
  office: {
    estate_agent: ['real-estate', 'Real estate office'], property_management: ['real-estate', 'Property management'],
    lawyer: ['professional', 'Law firm'], notary: ['professional', 'Notary'], architect: ['professional', 'Architect'],
    insurance: ['money', 'Insurance agency'], financial: ['money', 'Financial services'], financial_advisor: ['money', 'Financial advisor'],
    accountant: ['money', 'Accountant'], tax_advisor: ['money', 'Tax preparation'], travel_agent: ['professional', 'Travel agency'],
    construction_company: ['home', 'Builder & contractor'], educational_institution: ['kids', 'Education center'],
    therapist: ['health', 'Therapy practice'], physician: ['health', 'Doctor’s office'],
  },
  craft: {
    plumber: ['home', 'Plumber'], electrician: ['home', 'Electrician'], hvac: ['home', 'Heating & cooling'], carpenter: ['home', 'Carpenter'],
    painter: ['home', 'Painter'], roofer: ['home', 'Roofer'], gardener: ['home', 'Landscaping'], locksmith: ['home', 'Locksmith'],
    photographer: ['professional', 'Photographer'], tailor: ['errands', 'Tailor & alterations'], shoemaker: ['errands', 'Shoe repair'],
    jeweller: ['shopping', 'Jewelry'], upholsterer: ['home', 'Upholstery'], caterer: ['restaurants', 'Caterer'], winery: ['groceries', 'Winery'],
    brewery: ['groceries', 'Brewery'], distillery: ['groceries', 'Distillery'], boatbuilder: ['auto', 'Boat builder & repair'],
  },
  healthcare: {
    counselling: ['health', 'Counseling'], psychotherapist: ['health', 'Counseling'], physiotherapist: ['health', 'Physical therapy'],
    dentist: ['dental', 'Dentist'], doctor: ['health', 'Doctor’s office'], optometrist: ['eye-care', 'Optometrist'],
    alternative: ['health', 'Alternative medicine'], audiologist: ['health', 'Hearing care'], podiatrist: ['health', 'Podiatrist'],
    laboratory: ['health', 'Lab'], clinic: ['health', 'Medical clinic'], pharmacy: ['health', 'Pharmacy'], rehabilitation: ['health', 'Rehabilitation'],
    speech_therapist: ['health', 'Speech therapy'], occupational_therapist: ['health', 'Occupational therapy'], chiropractor: ['health', 'Chiropractor'],
  },
  leisure: {
    fitness_centre: ['fitness', 'Gym'], sports_centre: ['fitness', 'Sports & fitness center'], dance: ['fitness', 'Dance studio'],
    golf_course: ['fitness', 'Golf club'], swimming_pool: ['fitness', 'Swim club'], escape_game: ['arts-fun', 'Escape room'],
    bowling_alley: ['arts-fun', 'Bowling'], miniature_golf: ['arts-fun', 'Mini golf'], amusement_arcade: ['arts-fun', 'Arcade'],
    trampoline_park: ['arts-fun', 'Trampoline park'],
  },
  tourism: {
    hotel: ['hotels-events', 'Hotel'], motel: ['hotels-events', 'Motel'], guest_house: ['hotels-events', 'Guest house'],
    gallery: ['arts-fun', 'Art gallery'], museum: ['arts-fun', 'Museum'], hostel: ['hotels-events', 'Hostel'],
    caravan_site: ['hotels-events', 'RV park'], camp_site: ['hotels-events', 'Campground'], apartment: null,
  },
};

const CUISINE_LABEL = {
  american: 'American', italian: 'Italian', pizza: 'Pizza', chinese: 'Chinese', japanese: 'Japanese', sushi: 'Sushi',
  thai: 'Thai', indian: 'Indian', mexican: 'Mexican', tex_mex: 'Tex-Mex', mediterranean: 'Mediterranean', greek: 'Greek',
  lebanese: 'Lebanese', turkish: 'Turkish', afghan: 'Afghan', persian: 'Persian', kebab: 'Kabob', peruvian: 'Peruvian',
  vietnamese: 'Vietnamese', korean: 'Korean', french: 'French', spanish: 'Spanish', seafood: 'Seafood', steak_house: 'Steakhouse',
  burger: 'Burgers', sandwich: 'Sandwiches', chicken: 'Chicken', salad: 'Salads', bagel: 'Bagels', breakfast: 'Breakfast',
  coffee_shop: 'Coffee', donut: 'Donuts', ice_cream: 'Ice cream', regional: 'American', asian: 'Asian', middle_eastern: 'Middle Eastern',
  latin_american: 'Latin American', salvadoran: 'Salvadoran', ramen: 'Ramen', noodle: 'Noodles', bbq: 'Barbecue', barbecue: 'Barbecue',
  vegan: 'Vegan', vegetarian: 'Vegetarian', deli: 'Deli', bubble_tea: 'Bubble tea', crepe: 'Crêpes', dessert: 'Desserts',
  tapas: 'Tapas', pakistani: 'Pakistani', nepalese: 'Nepalese', ethiopian: 'Ethiopian', german: 'German', irish: 'Irish',
  brazilian: 'Brazilian', cuban: 'Cuban', hawaiian: 'Hawaiian', poke: 'Poké', fish: 'Seafood', wings: 'Wings', hot_dog: 'Hot dogs',
};

const NON_CONSUMER_OFFICES = new Set(['company', 'it', 'government', 'diplomatic', 'association', 'ngo', 'political_party',
  'religion', 'research', 'telecommunication', 'consulting', 'logistics', 'coworking', 'yes', 'administrative', 'union', 'employment_agency']);

/** Decide category + subcategory for an OSM tag set, or null to skip. */
export function classify(tags) {
  const t = tags || {};
  if (t.amenity === 'school' && !/academy|montessori|waldorf|preschool|pre-school|learning|day ?care|child|nursery|kumon|tutor|prep|school of|christian|catholic|episcopal|lutheran|adventist|day school/i.test(t.name || '')) return null;
  if (t.office && NON_CONSUMER_OFFICES.has(t.office) && !t.shop && !t.amenity && !t.healthcare) return null;
  for (const key of ['amenity', 'shop', 'healthcare', 'craft', 'office', 'leisure', 'tourism']) {
    const v = t[key];
    if (!v) continue;
    const table = MAP[key];
    if (!(v in table)) continue;
    const hit = table[v];
    if (hit === null) return null;
    let [category, sub] = hit;
    if (key === 'shop' && v === 'beauty' && /nail/i.test(`${t.beauty || ''} ${t.name || ''}`)) sub = 'Nail salon';
    if (key === 'shop' && v === 'hairdresser' && /barber/i.test(t.name || '')) sub = 'Barbershop';
    if ((v === 'restaurant' || v === 'fast_food') && t.cuisine) {
      const first = t.cuisine.split(';')[0].trim();
      const label = CUISINE_LABEL[first];
      if (label) sub = v === 'fast_food' ? `${label} (quick service)` : `${label} restaurant`;
    }
    if (v === 'cafe' && t.cuisine && /ice_cream/.test(t.cuisine)) { category = 'cafes-treats'; sub = 'Ice cream shop'; }
    if (v === 'cafe' && /bubble|boba|tea/i.test(`${t.cuisine || ''} ${t.name || ''}`) && !/coffee/i.test(t.name || '')) sub = 'Tea & bubble tea';
    return { category, sub };
  }
  return null;
}

/** Search keywords derived from OSM tags. */
export function osmTags(tags) {
  const t = tags || {};
  const out = [];
  if (t.cuisine) for (const c of t.cuisine.split(';')) out.push((CUISINE_LABEL[c.trim()] || c.trim().replace(/_/g, ' ')).toLowerCase());
  if (t.brand) out.push(t.brand.toLowerCase());
  if (t.takeaway === 'yes' || t.takeaway === 'only') out.push('takeout');
  if (t.delivery === 'yes') out.push('delivery');
  if (t.outdoor_seating === 'yes') out.push('outdoor seating');
  if (t.drive_through === 'yes') out.push('drive thru');
  if (t['diet:vegan'] === 'yes') out.push('vegan');
  if (t['diet:vegetarian'] === 'yes') out.push('vegetarian');
  if (t['diet:gluten_free'] === 'yes') out.push('gluten free');
  if (t.amenity === 'fuel') out.push('gas', 'fuel');
  if (t.amenity === 'pharmacy') out.push('pharmacy', 'prescriptions');
  if (t.shop === 'dry_cleaning') out.push('dry cleaning', 'dry cleaner');
  if (t.shop === 'alcohol') out.push('wine', 'beer', 'liquor');
  if (t.atm === 'yes') out.push('atm');
  return uniq(out);
}

/** Convert one OSM element into a candidate record (or null). */
export function fromOsm(el) {
  const t = el.tags || {};
  if (!t.name || t.disused || t['disused:shop'] || t['disused:amenity'] || /^(closed|vacant)$/i.test(t.name)) return null;
  if (t.opening_hours === 'closed' || t['was:shop'] || t['was:amenity']) return null;
  const cls = classify(t);
  if (!cls) return null;
  // Only real street addresses ("401 North Main Street"), never "PO Box 159".
  const hn = String(t['addr:housenumber'] || '').trim();
  const street = /^\d/.test(hn) && t['addr:street'] ? prettyStreet(`${hn} ${t['addr:street']}`) : '';
  return {
    source: 'osm',
    osmId: el.id,
    name: t.name.trim(),
    category: cls.category,
    sub: cls.sub,
    tags: osmTags(t),
    address: street,
    unit: t['addr:unit'] ? `Suite ${t['addr:unit']}` : '',
    zip: (t['addr:postcode'] || '').slice(0, 5),
    city: t['addr:city'] || '',
    phone: formatPhone(t.phone || t['contact:phone']),
    website: cleanUrl(t.website || t['contact:website'] || t.url),
    hours: normalizeHours(t.opening_hours) || '',
    lat: el.lat, lon: el.lon,
    inCity: el.inCity,
    brand: t.brand || '',
    sources: [`https://www.openstreetmap.org/${el.id}`],
  };
}
