"use strict";
// An authored pool with several independent naming styles; no serial bot labels.
const {createHash}=require('node:crypto');
const {spacedNickname}=require('./spaced-nickname');
const words=s=>s.trim().split(/\s+/u),lines=s=>s.trim().split('\n').map(s=>s.trim()).filter(Boolean);
const standalone=words(`
Шуршик Тыквёнок Кусь Плюх Бублик Крендель Барсик Кнопа Пушок Клякса Клёпа Фырка Шмяк Шпуньк Шуша Шлёпа Тапок Пельмень Пончо Капуч Какао Моти Матча Мята Лайм Киви Манго Паприка Куркума Имбирь Чили Васаби Корица Тоффи Ириска Карамель Зефир Мармелад Щербет Пломбир Кекс Маффин Брауни Круассан Печенька Вафля Галета Пряник Крекер Сухарик Пастила Булочка Козинак Пудинг Лимонад Компот Морс Квас Смузи Чаёк Кофеёк Фисташка Фундук Миндаль Кешью Изюм Курага Урюк Инжир Финик Кедрач
Няша Пуся Мурч Мякиш Мурзик Мурчик Мяуза Мурка Котя Котик Котэ Рыжик Уголёк Снежок Пушинка Пёрышко Птенчик Совёнок Сыч Филин Ворон Галчонок Чиж Стриж Зяблик Снегирь Иволга Сойка Скворец Пингвин Пеликан Тукан Какаду Фенёк Лисёнок Енот Енотик Выдра Норка Хорёк Лемур Сурикат Бобр Бобрик Капибара Тушканчик Суслик Хомяк Хомыч Ёжик Ёрш Карасик Налим Нерпа Тюлень Утконос Манул Сервал Оцелот Рысь Панда Коала Вомбат Опоссум Бизон Зубр Як Лось Олень Марал Зайц Заяц Кроля Жабка Кваки Жужа Шмель Шершень Светляк Мотылёк Улитка Крабик Омар Кальмар Осьминог Скат Китёнок Дельфин Акула Медуза Морж
Искра Вспышка Блик Блеск Лучик Огонёк Уголёчек Уют Туман Иней Сумрак Отблеск Мираж Фантом Эхо Шорох Шелест Рокот Шёпот Тишина Гром Гроза Зарница Молния Ветер Вихрь Шквал Тайфун Бриз Муссон Зефирка Буран Вьюга Метель Снегопад Снежинка Кристалл Осколок Роса Капля Волна Прибой Рябь Омут Родник Ручеёк Риф Айсберг Комета Метеор Орбита Квазар Пульсар Небула Зенит Надир Космос Спутник Звездочёт Аврора Селена Полярис Сириус Вега Альтаир Денеб Арктур Ригель Антарес Орион Лира Феникс Драко Меридиан
Кубик Пиксель Бит Байт Курсор Клик Клац Пинг Лаггер Дрифт Нитро Турбо Реверс Рикошет Зигзаг Каскад Квест Лутыч Фраг Сплит Блинк Додж Флип Трикс Муви Нерф Бафф Крит Хитбокс Зум Спарк Глитч Флик Свип Рашер Скип Смайл Хэппи Фанки Чилл Вайб Дзен Мило Локи Немо Реми Рони Рики Тимо Томи Мико Мика Ника Лика Лея Лана Лина Луна Руна Нора Нола Нелли Фрея Эйра Айви Юки Юми Йоши Хару Сора Рин Рэй Кай Кен Эш Зои Мэй Мио Аки Кира Ася Тася Тося Тая Нюша Дуся Люся Веся Сева Сёма Сима Фима Санёк Санька Саня Шурик Лёха Лёша Лёлик Димон Димыч Вован Вовка Вадик Владик Ромыч Ромка Русик Серёга Серый Антоха Тоха Денчик Даня Даник Егорка Илюха Костян Костик Тимоха Паштет Паша Палыч Михалыч Петрович Юрец Юрик Витёк Витька Гоша Гриша Федя Федька Стёпа Степыч Васька Валёк Максик Макс Жека Женёк Артёмка Тёма Толик Толя Никитос Никита Глебыч Боря Борисыч Олежек Олег Лёня Леон Марк Мирон Назар Арс Серж Вэл Джей
Анюта Анька Анна Катюха Катя Катёна Машуня Маша Маруся Марья Дашуля Даша Дэша Натка Наташа Настёна Настя Асяня Викуля Вика Вишенка Лерка Лера Лерчик Ленка Лена Алёна Алёнка Юлька Юля Юляша Ксюха Ксюня Ксюша Оля Ольчик Олька Поля Полина Соня Софи Софа Злата Зося Зоя Тоня Нина Ниночка Лиля Лилия Люба Любаша Танюха Таня Танюша Рита Марго Ира Иришка Галя Галка Валя Валюша Женька Ната Лиза Лизок Лизонька Ева Эля Элли Инга Инна Влада Яна Яся Уля Ульяна Диана Дина Милана Мила Мира Майя Рая Роза Роззи Алиса Алиска Алеська Алина Алиша Эмма Эми Снежа Снежана Лада Ладушка Надя Надюша Вера Верочка Неля Нелка Никаша
Кнопыч Тишик Шушик Крош Шустряк Тихоня Соняша Лентяй Бродяга Странник Скиталец Пилигрим Беглец Прохожий Гость Зевака Сосед Незнакомец Чудак Чудик Кудряш Лохматик Борода Усач Очкарик Умник Знаток Фокусник Магистр Алхимик Чародей Кудесник Механик Инженер Пилот Штурман Капитан Боцман Кок Юнга Матрос Лоцман Рыбак Лесник Егерь Следопыт Пастух Садовник Пекарь Повар Бариста Музыкант Бард Гитарист Басист Джазмен Дирижёр Скрипач Барабанщик Художник Поэт Автор Читатель Сказочник Затейник Игрун Весельчак Хитрюга Упрямец Везунчик Счастливчик Баловень Растяпа Копуша Торопыга Непоседа Проказник Фантазёр Мечтатель Наблюдатель Созерцатель Коллекционер
`);
const phrases=lines(`
НеЖмиНаМеня
КудаКнопка
ЯНаМинутку
ЩасВернусь
ЗаКофе
ПочтиПопал
ОпятьМимо
НеВТильте
ВсёПоПлану
ЭтоБылПинг
МамЯВТопе
ГдеМойЧай
УшёлЗаХлебом
ЕщёКаточку
ПоследнийЗаход
НеЕшьМеня
ЯНесъедобный
СначалаКофе
МнеБезСахара
ЗатоКрасиво
ПочтиЛегенда
ОйЭтоЯ
НуПогоди
ПотомОбъясню
КтоЗдесь
БезПаники
ЛадноЖивём
ПланБ
ПланНеОчень
ГдеВыход
ПлывуКакМогу
УжеБегу
ТихоЯТут
НеСплю
СонОтменяется
ЕщёПятьМинут
СейчасПриду
АМожноЧаю
ЧтоЗаШар
МойХод
ТакИЗадумано
КтоСъелЛут
ЧейЭтоКот
НеМойТапок
ПростоМимо
НеСегодня
НаЛайте
БезШансовНоДа
ЯТакЧувствую
ОпятьВторой
КудаЯНажал
ВродеЖивой
НуПочти
ДаЯПомню
ОноСамо
НичегоНеТрогал
ТутБылЯ
ВасНеСлышно
ЧатНеЧитаю
СлышуКлавиши
ГдеМойКурсор
УМышкиЛапки
КлавишаЗалипла
ИграюЛоктем
ИщуСвойКлан
НеЗовиМеня
ПогналиДомой
ЧайОстывает
МойКотГлавный
ТапкиВСтудию
НадоПоспать
ЗавтраВТоп
ТопПодождёт
ЯЗаПеченькой
НеТотПоворот
ПрямоИНаправо
НаКраюКарты
ГдеТоРядом
СлеваОтТебя
СправаКот
УКогоКлючи
НеСмотриСюда
ТишеЕдешь
ДайтеРазгон
ТормозаЕсть
ОсторожноЯ
ВсёЕщёТут
ЯНеПропал
ИдуКрасиво
БезРезких
НаСвоейВолне
РовноВПолночь
ПослеДождя
ДоПервойЗвезды
ТриЧашкиКофе
ДваКусочкаСыра
КотВОтпуске
ТапокВПанике
НеБудитеБобра
ЗдесьЖивётЛис
ОставьМнеЛут
РукиПомнят
ВсёПодКонтролем
ПочтиБезЛага
ПингНеВрёт
ВзялИУпал
НуБывает
ВотЭтоПоворот
ЛадноЕщёРаз
КручуВерчу
СлучайныйКрит
ВремяДляЧая
ДомойНеСкоро
СохраниМнеМесто
ПридуСПеченьем
ЗовитеПростоКот
НикПотом
НикПридуман
ИмяЗанято
СюдаНеБей
НаЧиле
ПодОдеялом
ВПледике
ГдеМоиОчки
ЛисНеПриДелах
КотНеВКурсе
ДедНаСвязи
ЧеловекТапок
КофеНаБегу
ПельменьУшёл
НеКормитеЛага
СлучайноВТопе
СкромныйКусь
ЧутьЧутьГерой
ГеройДоУжина
НеТотЛис
ЯТолькоГляну
УжеПобедил
ВТапкахБыстрее
ДоброеУтроКот
НеМешайЗевать
ПокаБезНика
БезЛишнихСлов
ВсёБудетЧай
ХлебИЗрелища
ПоймайСначала
ЛовиПельмень
ОйЛечу
ВЖУХ
ТыкИГотово
МимоКассы
НеЛовиМеня
ТолькоНеВСтены
Кофе с собой
Синий тапок
Чай без сахара
Енот на связи
Лис и точка
Кот на отдыхе
Почти чемпион
Не спешу
Ну давай
Я просто мимо
План был другой
Утро не задалось
Последний кусь
Тихий вечер
Нормально идём
Шарик катится
Рыжий сосед
Ночной чай
Зато с душой
Дайте поспать
`);
const latin=words(`Muffin Toast Waffle Mochi Latte Cocoa Matcha Mint Kiwi Mango Pepper Ginger Cookie Crumble Biscuit Pudding Noodle Sushi Wasabi Tofu Nacho Taco Ramen Bento Dumpling Peanut Cashew Hazel Walnut Peach Apricot Berry Cherry Olive Plum Melon Lemon Lime Lychee Fig Date Coconut Papaya Guava Apri Saffron Basil Thyme Parsley Clover Maple Cedar Willow Aspen Birch Hazelwood Pine Spruce Oak Fern Moss Leaf Petal Bloom Bud Acorn Pollen Pebble Flint Onyx Opal Amber Jade Coral Pearl Ruby Topaz Quartz Cobalt Silver Copper Bronze Nickel Ember Ash Spark Cinder Blaze Flare Flicker Glow Glimmer Gleam Shimmer Twinkle Nova Luna Sol Solar Lunar Aurora Nebula Comet Meteor Orbit Pulsar Quasar Zenith Nadir Cosmo Astro Vega Sirius Rigel Deneb Altair Arcturus Polaris Lyra Orion Draco Echo Whisper Hush Murmur Rustle Ripple Wave Tide Surge Drift Breeze Gust Gale Storm Thunder Rain Drizzle Mist Haze Fog Frost Snow Sleet Hail Blizzard Winter Spring Summer Autumn Dawn Dusk Noon Midnight Twilight Sunset Sunrise Fable Riddle Rune Myth Saga Tale Lore Mystic Enigma Mirage Phantom Spectre Shadow Shade Ghost Wisp Fairy Sprite Pixie Nymph Dryad Sylph Nox Nyx Vex Vox Flux Lynx Fox Wolf Otter Badger Ferret Stoat Marten Weasel Sable Fennec Raccoon Panda Koala Wombat Quokka Capybara Gecko Axolotl Moth Beetle Cricket Cicada Bumble Bee Firefly Dragonfly Sparrow Finch Robin Wren Lark Swift Swallow Jay Raven Crow Magpie Owl Falcon Hawk Kestrel Kite Eagle Osprey Puffin Penguin Pelican Toucan Parrot Macaw Cockatoo Pixel Byte Bit Glitch Ping Pong Flick Blink Dash Rush Zoom Zip Skip Hop Jump Flip Spin Twist Tilt Shift Strafe Swerve Dodge Juke Feint Clutch Ace Apex Peak Crest Edge Corner Angle Vector Vertex Axis Pivot Torque Nitro Turbo Boost Brake Reverse Retro Remix Reverb Tempo Rhythm Groove Jazz Blues Funk Soul LoFi Chill Vibe Zen Cozy Comfy Sleepy Snoozy Dozy Lazy Dizzy Wuzzy Fuzzy Floofy Fluffy Puffy Squishy Bouncy Wobbly Wiggly Jiggly Mellow Sunny Happy Silly Goofy Dorky Quirky Cheeky Sneaky Spooky Lucky Plucky Zippy Zappy Snappy Sassy Jazzy Fizzy Breezy Dreamy Starry Cloudy Rainy Snowy Frosty Toasty Crispy Crunchy Chewy Gooey Sticky Salty Sweet Sour Spicy Zesty Tasty Yummy Nomnom YumYum Boop Beep Bloop Blip Blob Smol Tiny Mini Micro Nano Pico Kiki Mimi Momo Nini Coco Lulu Lolo Ruru Roro Koko Toto Titi Riri Yoyo Yuki Yumi Yoshi Haku Haru Sora Kumo Shiro Kuro Akira Aki Rin Ren Rei Ryo Kai Ken Kyo Miko Mika Miku Neko Nyanko Peko Piko Piku Riku Rika Ruko Rumi Remi Rami Roni Rani Rena Rina Runa Runo Timo Toma Tobi Tori Taro Yori Yuna Yona Yara Yura Yuli Yuma Zuri Zora Zola Zara Zina Zeno Arlo Aaro Milo Miro Niro Niko Nico Enzo Elio Ezio Ivo Neo Noa Noel Leon Leo Lio Luca Luka Ludo Luno Luma Lumen Lumi Nori Nomi Numa Nami Navi Naviq Koda Kovu KovuFox Mako Maki Moko Moku Moti Moxy Roxy Foxy Doxy Soxy Jinx Jynx Lynxi Vixi Vixie Trix Trixie Nyxi Nyxie`);
const combine=(a,b)=>a.flatMap(x=>b.map(y=>x+y));
const rusCombos=combine(words('Сонный Мятный Рыжий Лунный Тёплый Хитрый Тихий Ламповый Шустрый Уютный Чайный Сырный Лёгкий Добрый Синий Ночной Летний Зимний Лесной Морской'),words('Лис Кот Бобр Енот Пончик Кекс Ёж Пингвин Манул Суслик Зефир Краб Тапок Пиксель Лось Гусь Шмель Кит Дракон Туман'));
const sceneCombos=combine(words('Кот Лис Енот Бобр Кекс Чай Кофе Тапок Гусь Пончик Пиксель Ёж Манул Пельмень'),words('БезСна БезЛага НаМиде НаКрыше ВПледе ВКедах НаЧиле ВТумане НаЛуне ВОтпуске ЗаУглом ПодДождём УКамина ЗаЧаем БезПлана'));
const englishCombos=combine(words('sleepy mint tiny cozy mellow lucky lil night cloud rainy toast fuzzy neon'),words('Fox Otter Panda Owl Cat Moose Gecko Bean Toast Mochi Pixel Ghost Lynx Frog Bird')); 
const signatures=words('Mika Neko Rin Kai Yuki Luna Sora Kira Nika Max Dan Leo Leon Arlo Milo Remi Лис Кот Кусь Шмяк Кекс Моти Пиксель Мята Енот Руна Искра Вафля Няша Шуршик');
const decorated=signatures.flatMap((name,i)=>[name+'_'+[7,13,17,23,27,42,73,77,91][i%9],name+'.exe',name+'~',name+'_'+['чай','zzz','afk','gg'][i%4]]);
function shuffled(list,salt){return [...list].sort((a,b)=>createHash('sha256').update(salt+':'+a).digest('hex').localeCompare(createHash('sha256').update(salt+':'+b).digest('hex')));}
function nicknamePool(){
 const groups=[standalone,phrases,latin,shuffled(rusCombos,'ru').slice(0,270),shuffled(sceneCombos,'scene').slice(0,150),shuffled(englishCombos,'en').slice(0,140),decorated].map((g,i)=>shuffled(g,'group'+i));
 const result=[];for(let i=0;i<Math.max(...groups.map(g=>g.length));i++)for(const g of groups)if(g[i])result.push(spacedNickname(g[i]));return result;
}
const clans=lines(`
X|Икс-Фактор
V|Пятый элемент
Z|Зигзаг удачи
R|Рикошет
Q|Кьюшки
W|Двойной шанс
S|Свои люди
N|Ночная смена
K|Круг своих
M|Между делом
T|Тихий час
F|Фан без плана
G|Гравитация
Y|Улыбнись
Ω|Омега
Я|Ярмарка чудес
GG|Хорошая катка
EZ|Без суеты
AF|После полуночи
42|Ответ найден
7K|Семь кружек
NB|Небо ближе
NF|Неформат
VP|Второй пинг
RF|Рыжий флаг
SR|Случайный рейд
NX|Следующий ход
PM|После матча
AP|Аплодисменты
OC|Очень странные
RX|Реакция
LT|Лёгкий тильт
DV|Два вдоха
HL|Хорошие люди
TF|Тёплый фронт
NW|Новая волна
ПБ|План Б
ХЗ|Кто нас знает
ДР|Друзья рядом
КП|Котики против
ЛС|Лунный свет
ПФ|Пуф и победа
ЩИ|Кислые щи
КТ|Кототерапия
ЧА|Чайная пауза
ЛЁ|Лёгкое касание
ДО|До рассвета
ОЙ|Ой всё
КО|Комната отдыха
ВО|Вот это да
КУ|Кукусики
ЛУ|Лут и уют
БО|Большой обед
ВЖ|Вжух и дома
НЕ|Не сегодня
ДА|Да будет чай
AFK|Мы за кофе
404|Клан не найден
FOX|Лисья нора
OWL|Совятня
RIP|Ещё одна попытка
BRB|Скоро вернёмся
GGG|Три хороших игры
NXT|На шаг впереди
SUN|Солнечный круг
ICE|Тонкий лёд
SKY|Выше крыш
DUS|Сумеречный двор
NOX|Ноктюрн
LUX|Луч света
VLT|Высокое напряжение
ZEN|Дзен и печеньки
ACE|Туз в рукаве
BAM|Бам и готово
ZIP|Молниеносные
JOY|Радость в мелочах
ДОМ|Дом там где кот
ЭХО|Эхо в горах
КЕК|Кековые будни
МЯУ|Министерство котов
ЛИС|Лисы не спят
ДЫМ|Дым над водой
ТУЗ|Козырной стол
ЧАЙ|Пока чай не остыл
ЛЁД|Ледоколы
СОН|Тихо мы спим
ТОП|Почти в топе
УЮТ|Плед и компания
ЛЕС|Лесная почта
КОТ|Служба доставки мур
ФАН|Чисто по фану
НОЧ|Ночь длиннее дня
ДЕД|Деды на связи
УРА|Повод нашёлся
ЖУК|Жуки на старте
КЭП|Капитаны очевидности
NOVA|Новый рассвет
LUNA|Обратная сторона Луны
MINT|Мятный квартал
HUSH|Тише воды
BYTE|Байтовые мечты
AURA|Своя атмосфера
WAVE|На своей волне
VOID|Между звёздами
FROG|Клуб важных жаб
LUCK|Везёт же людям
DICE|Бросок судьбы
RUSH|Без тормозов
LOFI|Лоуфай на фоне
COZY|Уютное место
NEON|Неоновые вывески
ZERO|С чистого листа
ХАОС|Управляемый хаос
БЛИК|Поймай блик
СОВЫ|Совсем не спим
ЛИСЫ|Рыжая компания
МЯТА|Мята и лимон
ПУХИ|Пушистый десант
СЫРЫ|Сырный заговор
ЛАВА|На горячем
ДЖЕМ|Малиновый джем
КОДЫ|Секретный уровень
ШУМЫ|Белый шум
БАНД|Банда в тапках
ТЕНЬ|Теневая сторона
ЗАРЯ|Первые лучи
ОПА|Неожиданный поворот
КВАС|Квасная компания
U|Удачный случай
P|Параллель
2X|Двойная порция
OK|Всё хорошо
FEN|Фенек и друзья
RAY|Световая дорожка
FLUX|Течение
ECHO|Отголоски
`);
module.exports={nicknamePool,clans:clans.map(row=>{const [prefix,name]=row.split('|');return{prefix,name};})};
