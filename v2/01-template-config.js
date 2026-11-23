// n8n Code node «Template Config» — Run Once for All Items.
// Одне місце, де живуть: поля, наші юрособи, шаблони, які поля потрібні якому шаблону, ринкові ставки.
// Новий шаблон = одна запис у TEMPLATES.

const FIELDS = {
  CONTRACT_NUMBER: '№ угоди в CRM',
  // Замовник
  CLIENT_COMPANY: 'Назва замовника', CLIENT_EDRPOU: 'ЄДРПОУ замовника', CLIENT_IPN: 'ІПН замовника',
  CLIENT_DIRECTOR: 'Директор замовника', CLIENT_BASIS: 'Підстава (замовник)', CLIENT_ADDRESS: 'Адреса замовника',
  CLIENT_IBAN: 'IBAN замовника', CLIENT_BANK: 'Банк замовника', CLIENT_PHONE: 'Телефон замовника',
  CLIENT_EMAIL: 'Email замовника', CLIENT_CONTACT: 'Контакт замовника',
  // Перевізник
  CARRIER_COMPANY: 'Назва перевізника', CARRIER_EDRPOU: 'ЄДРПОУ/РНОКПП перевізника', CARRIER_IPN: 'ІПН перевізника',
  CARRIER_DIRECTOR: 'Директор перевізника', CARRIER_BASIS: 'Підстава (перевізник)', CARRIER_ADDRESS: 'Адреса перевізника',
  CARRIER_IBAN: 'IBAN перевізника', CARRIER_BANK: 'Банк перевізника', CARRIER_PHONE: 'Телефон перевізника',
  CARRIER_EMAIL: 'Email перевізника', CARRIER_CONTACT: 'Контакт перевізника', CARRIER_TAX: 'Податковий статус перевізника',
  // Рейс
  ROUTE: 'Маршрут', CARGO_INFO: 'Вантаж', CARGO_DIMENSIONS: 'Місця, габарити', CARGO_VALUE: 'Вартість вантажу',
  CARGO_REQUIREMENTS: 'Вимоги до ТЗ', SPECIAL_CONDITIONS: 'Особливі умови',
  SENDER_INFO: 'Вантажовідправник', SENDER_CONTACT: 'Контакт відправника',
  LOADING_ADDRESS: 'Адреса завантаження', LOADING_DATE: 'Дата завантаження',
  CUSTOMS_LOADING: 'Замитнення', BORDER_POINT: 'Перетин кордону', CUSTOMS_UNLOADING: 'Розмитнення',
  RECEIVER_INFO: 'Вантажоодержувач', RECEIVER_CONTACT: 'Контакт одержувача',
  UNLOADING_ADDRESS: 'Адреса розвантаження', DELIVERY_DATE: 'Дата доставки',
  VEHICLE_INFO: 'Авто й причіп', DRIVER_INFO: 'Водій', EXTRA_CONDITIONS: 'Додаткові умови', EXPEDITOR_CONTACT: 'Контакт експедитора',
  // Гроші
  SERVICE_PRICE: 'Ціна для замовника', CLIENT_TERMS: 'Оплата замовника',
  TRANSPORT_PRICE: 'Ціна перевізнику', CARRIER_TERMS: 'Оплата перевізнику',
};

const OUR = {
  automov: { short: 'ТОВ «АвтоМув»', edrpou: '45618360', vat: false, intl: true,
    text: 'ТОВ «АвтоМув», ЄДРПОУ 45618360, директор Ковтонюк Тетяна Миколаївна, 04201 м. Київ, вул. Полярна, 10Г, платник єдиного податку 3 групи, без ПДВ' },
  uts: { short: 'ТОВ «Юнайтед Транспорт Сервіс»', edrpou: '44186230', vat: true, intl: false,
    text: 'ТОВ «Юнайтед Транспорт Сервіс» (ЮТС), ЄДРПОУ 44186230, директор Беспятчук Сергій Степанович, платник ПДВ' },
};
const MANAGER = 'Чукін Євген Володимирович, 093 793 82 65';

const CLIENT_REQ = ['CLIENT_COMPANY', 'CLIENT_EDRPOU', 'CLIENT_DIRECTOR', 'CLIENT_BASIS', 'CLIENT_ADDRESS', 'CLIENT_IBAN', 'CLIENT_BANK', 'CLIENT_PHONE'];
const CARRIER_REQ = ['CARRIER_COMPANY', 'CARRIER_EDRPOU', 'CARRIER_BASIS', 'CARRIER_ADDRESS', 'CARRIER_IBAN', 'CARRIER_BANK', 'CARRIER_PHONE'];
const ROUTE_REQ = ['ROUTE', 'CARGO_INFO', 'LOADING_ADDRESS', 'LOADING_DATE', 'UNLOADING_ADDRESS', 'DELIVERY_DATE'];
const INTL_REQ = ['CUSTOMS_LOADING', 'BORDER_POINT', 'CUSTOMS_UNLOADING'];

// templateId — з v1 (вузол Copy file)
const TEMPLATES = {
  automov_z: { co: 'automov', side: 'z', templateId: '1gfenO1zSBdL9m_Wpf5iy0NBOCznrgTOw', title: 'Договір із замовником (АвтоМув)',
    required: [...CLIENT_REQ, ...ROUTE_REQ, 'SERVICE_PRICE'] },
  automov_p: { co: 'automov', side: 'p', templateId: '1nlk5kNBTS5HvE-pEPEI1PohbtmvNBbY1', title: 'Заявка перевізнику (АвтоМув)',
    required: [...CARRIER_REQ, ...ROUTE_REQ, 'VEHICLE_INFO', 'DRIVER_INFO', 'TRANSPORT_PRICE'] },
  uts_z: { co: 'uts', side: 'z', templateId: '184GT2KmxCF0XODooqt70msiDh-t-xLD6', title: 'Договір із замовником (ЮТС)',
    required: [...CLIENT_REQ, ...ROUTE_REQ, 'SERVICE_PRICE'] },
  uts_p: { co: 'uts', side: 'p', templateId: '1MKR9DqCj86G3QJuf-y2vMUKKbWZmPxHu', title: 'Заявка перевізнику (ЮТС)',
    required: [...CARRIER_REQ, ...ROUTE_REQ, 'VEHICLE_INFO', 'DRIVER_INFO', 'TRANSPORT_PRICE'] },
};
// роль із сесії → які шаблони генерувати
const ROLE_DOCS = {
  automov_z: ['automov_z'], automov_p: ['automov_p'], automov_both: ['automov_z', 'automov_p'],
  uts_z: ['uts_z'], uts_p: ['uts_p'], uts_both: ['uts_z', 'uts_p'],
};

// Ринкові ставки перевізнику, грн/км (ваші цифри, жовтень 2026). Короткий рейс — не менше min.
const RATES = [
  { id: 't20', name: 'фура 20–22 т', cap: 22, rate: { cash: 75, ep: 83, vat: 85 }, min: 20000 },
  { id: 't10', name: '10 т', cap: 10, rate: { cash: 50, ep: 62, vat: 65 }, min: 12000 },
  { id: 't5', name: '5 т', cap: 5, rate: { cash: 40, ep: 52, vat: 55 }, min: 8000 },
  { id: 't3', name: '1,5–3 т', cap: 3, rate: { cash: 30, ep: 38, vat: 40 }, min: 5000 },
];

return [{ json: { FIELDS, OUR, MANAGER, INTL_REQ, TEMPLATES, ROLE_DOCS, RATES } }];
