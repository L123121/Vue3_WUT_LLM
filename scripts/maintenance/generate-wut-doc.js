const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, LevelFormat,
  HeadingLevel, BorderStyle, WidthType, ShadingType,
  VerticalAlign, PageNumber, PageBreak
} = require('docx');

// Color palette
const C = {
  primary: '1B4F72',
  accent: '2E86C1',
  light: 'D6EAF8',
  gray: '666666',
  dark: '222222',
  white: 'FFFFFF',
  border: 'BBBBBB',
  headerBg: '1B4F72',
};

const border = { style: BorderStyle.SINGLE, size: 1, color: C.border };
const cellBorders = { top: border, bottom: border, left: border, right: border };

// Chinese double quotation marks - use these constants instead of literal chars
const LQ = '“'; // "
const RQ = '”'; // "

function q(s) { return LQ + s + RQ; }

function heading1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 400, after: 200 },
    children: [new TextRun({ text, bold: true, size: 36, color: C.primary, font: 'Microsoft YaHei' })],
  });
}

function heading2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 300, after: 160 },
    children: [new TextRun({ text, bold: true, size: 30, color: C.accent, font: 'Microsoft YaHei' })],
  });
}

function para(text, opts = {}) {
  return new Paragraph({
    alignment: opts.align || AlignmentType.JUSTIFIED,
    spacing: { before: 80, after: 80, line: 360 },
    indent: opts.noIndent ? undefined : { firstLine: 480 },
    children: [new TextRun({
      text, size: 22, font: 'Microsoft YaHei', color: opts.color || C.dark,
      bold: opts.bold, italics: opts.italics,
    })],
  });
}

function spacer(h) { return new Paragraph({ spacing: { before: h || 200, after: h || 200 }, children: [] }); }

function bulletItem(text) {
  return new Paragraph({
    numbering: { reference: 'bullet-list', level: 0 },
    spacing: { before: 40, after: 40, line: 340 },
    children: [new TextRun({ text, size: 22, font: 'Microsoft YaHei', color: C.dark })],
  });
}

function infoRow(label, value) {
  return new Paragraph({
    spacing: { before: 60, after: 60 },
    children: [
      new TextRun({ text: label, bold: true, size: 22, font: 'Microsoft YaHei', color: C.primary }),
      new TextRun({ text: value, size: 22, font: 'Microsoft YaHei', color: C.dark }),
    ],
  });
}

function headerCell(text, width) {
  return new TableCell({
    borders: cellBorders,
    width: { size: width, type: WidthType.DXA },
    shading: { fill: C.headerBg, type: ShadingType.CLEAR },
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 60, after: 60 },
      children: [new TextRun({ text, bold: true, size: 22, color: C.white, font: 'Microsoft YaHei' })],
    })],
  });
}

function dataCell(text, width, opts) {
  opts = opts || {};
  return new TableCell({
    borders: cellBorders,
    width: { size: width, type: WidthType.DXA },
    shading: opts.shading ? { fill: opts.shading, type: ShadingType.CLEAR } : undefined,
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 50, after: 50 },
      children: [new TextRun({ text, size: 21, font: 'Microsoft YaHei', color: C.dark, bold: opts.bold })],
    })],
  });
}

function zq(text) {
  // Replace ASCII double-quote pairs within the text with proper Chinese quotes
  // We use a marker approach: pairs of " get converted to “ and ”
  let result = '';
  let open = true;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') {
      result += open ? LQ : RQ;
      open = !open;
    } else {
      result += text[i];
    }
  }
  return result;
}

const doc = new Document({
  styles: {
    default: {
      document: { run: { font: 'Microsoft YaHei', size: 22 } },
    },
    paragraphStyles: [
      {
        id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 36, bold: true, color: C.primary, font: 'Microsoft YaHei' },
        paragraph: { spacing: { before: 400, after: 200 }, outlineLevel: 0 },
      },
      {
        id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 30, bold: true, color: C.accent, font: 'Microsoft YaHei' },
        paragraph: { spacing: { before: 300, after: 160 }, outlineLevel: 1 },
      },
    ],
  },
  numbering: {
    config: [
      {
        reference: 'bullet-list',
        levels: [{
          level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } },
        }],
      },
    ],
  },
  sections: [
    // ==================== COVER PAGE ====================
    {
      properties: {
        page: {
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
      },
      children: [
        spacer(2400),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
          children: [new TextRun({ text: '武汉理工大学', size: 72, bold: true, color: C.primary, font: 'Microsoft YaHei' })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 100 },
          children: [new TextRun({ text: 'WUHAN UNIVERSITY OF TECHNOLOGY', size: 32, color: C.accent, font: 'Arial', italics: true })],
        }),
        spacer(400),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          border: { top: { style: BorderStyle.SINGLE, size: 6, color: C.primary, space: 1 } },
          spacing: { before: 200, after: 200 },
          children: [],
        }),
        spacer(400),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 100 },
          children: [new TextRun({ text: '校园资料手册', size: 44, bold: true, color: C.dark, font: 'Microsoft YaHei' })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 100 },
          children: [new TextRun({ text: 'Campus Information Handbook', size: 26, color: C.gray, font: 'Arial', italics: true })],
        }),
        spacer(600),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 60 },
          children: [new TextRun({ text: '教育部直属全国重点大学', size: 24, color: C.accent, font: 'Microsoft YaHei' })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 60 },
          children: [new TextRun({ text: zq('国家"211工程"和"双一流"建设高校'), size: 24, color: C.accent, font: 'Microsoft YaHei' })],
        }),
        spacer(1200),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: '2025年7月', size: 22, color: C.gray, font: 'Microsoft YaHei' })],
        }),
      ],
    },
    // ==================== TABLE OF CONTENTS ====================
    {
      properties: {
        page: {
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: C.border, space: 4 } },
            children: [new TextRun({ text: '武汉理工大学 · 校园资料手册', size: 16, color: C.gray, font: 'Microsoft YaHei' })],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            border: { top: { style: BorderStyle.SINGLE, size: 1, color: C.border, space: 4 } },
            children: [
              new TextRun({ text: '第 ', size: 18, color: C.gray }),
              new TextRun({ children: [PageNumber.CURRENT], size: 18, color: C.gray }),
              new TextRun({ text: ' 页', size: 18, color: C.gray }),
            ],
          })],
        }),
      },
      children: [
        heading1('目 录'),
        spacer(200),
        ...[
          ['一、学校概况', 3],
          ['二、历史沿革', 4],
          ['三、校区分布', 5],
          ['四、学院与学科设置', 7],
          ['五、师资力量', 8],
          ['六、校园设施', 9],
          ['七、校园文化', 11],
          ['八、国际合作与交流', 12],
          ['九、招生就业', 13],
          ['十、联系方式', 14],
        ].map(([t, p]) =>
          new Paragraph({
            spacing: { before: 100, after: 100 },
            tabStops: [{ type: 2, position: 9360 }],
            children: [
              new TextRun({ text: t, size: 24, font: 'Microsoft YaHei', color: C.dark }),
              new TextRun({ text: String(p), size: 24, font: 'Microsoft YaHei', color: C.gray }),
            ],
          })
        ),
      ],
    },
    // ==================== MAIN CONTENT ====================
    {
      properties: {
        page: {
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: C.border, space: 4 } },
            children: [new TextRun({ text: '武汉理工大学 · 校园资料手册', size: 16, color: C.gray, font: 'Microsoft YaHei' })],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            border: { top: { style: BorderStyle.SINGLE, size: 1, color: C.border, space: 4 } },
            children: [
              new TextRun({ text: '第 ', size: 18, color: C.gray }),
              new TextRun({ children: [PageNumber.CURRENT], size: 18, color: C.gray }),
              new TextRun({ text: ' 页', size: 18, color: C.gray }),
            ],
          })],
        }),
      },
      children: [
        // ===== Section 1 =====
        heading1('一、学校概况'),
        para(zq('武汉理工大学（Wuhan University of Technology，简称WUT）是教育部直属全国重点大学，国家"211工程"和"双一流"建设高校。学校坐落于湖北省武汉市，是教育部和交通运输部等部委共建高校，入选"111计划"、"卓越工程师教育培养计划"、"国家大学生创新性实验计划"等国家教育项目。')),
        para(zq('学校办学历史最早可追溯至1898年成立的湖北工艺学堂。经过百余年的发展，武汉理工大学已建设成为以工学为主，工、理、管、经、文、法、艺术等多学科相互渗透、协调发展的全国重点大学，在材料科学与工程、船舶与海洋工程、交通运输工程等领域具有鲜明的办学特色和突出的学科优势。')),
        spacer(100),
        infoRow('中文名称：', '武汉理工大学'),
        infoRow('英文名称：', 'Wuhan University of Technology (WUT)'),
        infoRow('创办时间：', '1898年（湖北工艺学堂）'),
        infoRow('学校类型：', '公立大学 · 理工类'),
        infoRow('主管部门：', '中华人民共和国教育部'),
        infoRow('校　　训：', '厚德博学、追求卓越'),
        infoRow('校庆日：', '每年5月的第三个星期六'),
        infoRow('学校地址：', '湖北省武汉市洪山区珞狮路122号（马房山校区）'),
        infoRow('邮政编码：', '430070'),
        infoRow('在校学生：', '约55,000余人（含本科生、硕士生、博士生及留学生）'),

        spacer(),
        new Paragraph({ children: [new PageBreak()] }),

        // ===== Section 2 =====
        heading1('二、历史沿革'),
        heading2('百年传承，三校合并'),
        para(zq('武汉理工大学由原武汉工业大学、原武汉交通科技大学和原武汉汽车工业大学三校于2000年5月27日合并组建而成。三校均为各自行业领域的重点大学，办学历史源远流长。')),
        spacer(100),

        new Table({
          columnWidths: [1600, 3880, 3880],
          rows: (function() {
            const rows = [
              { a: '时期', b: '学校名称', c: '备注', header: true },
              { a: '1898年', b: '湖北工艺学堂', c: '武汉工业大学前身' },
              { a: '1946年', b: '国立海事职业学校', c: '武汉交通科技大学前身' },
              { a: '1958年', b: '武汉工学院', c: '武汉汽车工业大学前身' },
              { a: '1985年', b: '武汉工业大学', c: '更名为武汉工业大学' },
              { a: '1993年', b: '武汉交通科技大学', c: '更名为武汉交通科技大学' },
              { a: '1995年', b: '武汉汽车工业大学', c: '更名为武汉汽车工业大学' },
              { a: '2000年5月', b: '武汉理工大学', c: '三校合并组建' },
            ];
            return rows.map(function(r) {
              if (r.header) {
                return new TableRow({
                  tableHeader: true,
                  children: [headerCell(r.a, 1600), headerCell(r.b, 3880), headerCell(r.c, 3880)],
                });
              }
              return new TableRow({
                children: [dataCell(r.a, 1600), dataCell(r.b, 3880, { bold: true }), dataCell(r.c, 3880)],
              });
            });
          })(),
        }),
        spacer(100),
        para(zq('合并后的武汉理工大学整合了三校在材料科学、交通工程、汽车工程等领域的优势资源，迅速成为国内理工科领域具有重要影响力的综合性大学。2001年，学校进入国家"211工程"重点建设高校行列。2017年，学校入选国家"双一流"建设高校名单，材料科学与工程学科入选"双一流"建设学科。')),

        spacer(),
        new Paragraph({ children: [new PageBreak()] }),

        // ===== Section 3 =====
        heading1('三、校区分布'),
        para('武汉理工大学现有三个主要校区——马房山校区、余家头校区和南湖校区，总占地面积约267万平方米（4000余亩），校舍总建筑面积约190万平方米。各校区功能互补、格局各异。'),
        spacer(100),

        heading2('1. 马房山校区（主校区）'),
        infoRow('地　址：', '武汉市洪山区珮狮路122号'),
        infoRow('占地面积：', '约120万平方米'),
        infoRow('功能定位：', '学校行政中心、材料科学与工程学科群、理学与人文社科'),
        para('马房山校区是武汉理工大学的主校区，也是学校的行政和教学科研中心。校内有标志性建筑——飞马广场、图书馆、行政大楼等。材料科学与工程国家级重点实验室、硅酸盐建筑材料国家重点实验室等高水平科研平台均坐落于此。'),
        spacer(60),

        heading2('2. 余家头校区'),
        infoRow('地　址：', '武汉市武昌区和平大道1040号'),
        infoRow('占地面积：', '约67万平方米'),
        infoRow('功能定位：', '船舶与海洋工程、交通运输工程学科群'),
        para('余家头校区位于长江之滨，原武汉交通科技大学所在地。校区以船舶与海洋工程、交通运输工程为特色，拥有国家水运安全工程技术研究中心、高性能船舶技术教育部重点实验室等重要科研平台。校区内的航海博物馆展示了中国航海事业的发展历程。'),
        spacer(60),

        heading2('3. 南湖校区'),
        infoRow('地　址：', '武汉市洪山区书城路'),
        infoRow('占地面积：', '约80万平方米'),
        infoRow('功能定位：', '汽车工程、经济管理、文法艺术学科群'),
        para('南湖校区是学校最新建设的校区，原武汉汽车工业大学所在地，现以汽车工程、经济管理、文法艺术等学科为主。校区环境优美，现代化教学设施齐全，图书馆、体育馆、学生公寓等硬件条件为全校最优。校内建有湖北省新能源汽车工程技术研究中心等科研机构。'),
        spacer(100),

        new Table({
          columnWidths: [2000, 2000, 3680, 1680],
          rows: (function() {
            const rows = [
              { a: '校区名称', b: '地址', c: '主要学科领域', d: '面积（万m²）', header: true },
              { a: '马房山校区', b: '洪山区珮狮路122号', c: '材料科学与工程、理学、人文社科', d: '约120' },
              { a: '余家头校区', b: '武昌区和平大道1040号', c: '船舶与海洋工程、交通运输', d: '约67' },
              { a: '南湖校区', b: '洪山区书城路', c: '汽车工程、经管、文法艺术', d: '约80' },
            ];
            return rows.map(function(r) {
              if (r.header) {
                return new TableRow({
                  tableHeader: true,
                  children: [headerCell(r.a, 2000), headerCell(r.b, 2000), headerCell(r.c, 3680), headerCell(r.d, 1680)],
                });
              }
              return new TableRow({
                children: [dataCell(r.a, 2000, { bold: true }), dataCell(r.b, 2000), dataCell(r.c, 3680), dataCell(r.d, 1680)],
              });
            });
          })(),
        }),

        spacer(),
        new Paragraph({ children: [new PageBreak()] }),

        // ===== Section 4 =====
        heading1('四、学院与学科设置'),
        para('武汉理工大学现有25个学院（部），涵盖工学、理学、管理学、经济学、文学、法学、艺术学等七大学科门类。学校拥有博士后科研流动站17个，一级学科博士点22个，一级学科硕士点45个，本科专业90余个。'),
        spacer(100),

        heading2('重点学科'),
        para(zq('学校材料科学与工程学科入选国家"双一流"建设学科，在全国第四轮学科评估中获证A+等级，位列全国第一。此外，学校还有多个学科具有显著优势：')),
        bulletItem('材料科学与工程（A+，世界一流学科）'),
        bulletItem('船舶与海洋工程'),
        bulletItem('交通运输工程'),
        bulletItem('机械工程'),
        bulletItem('管理科学与工程'),
        bulletItem('设计学'),
        bulletItem('马克思主义理论'),
        bulletItem('环境科学与工程'),
        spacer(60),

        heading2('学院设置'),
        spacer(60),

        new Table({
          columnWidths: [4680, 4680],
          rows: (function() {
            var items = [
              ['工学类', '材料科学与工程学院'],
              ['工学类', '交通与物流工程学院'],
              ['工学类', '船海与能源动力工程学院'],
              ['工学类', '汽车工程学院'],
              ['工学类', '机电工程学院'],
              ['工学类', '土木工程与建筑学院'],
              ['工学类', '资源与环境工程学院'],
              ['工学类', '信息工程学院'],
              ['工学类', '计算机与人工智能学院'],
              ['工学类', '自动化学院'],
              ['工学类', '化学化工与生命科学学院'],
              ['理学类', '理学院'],
              ['管理学类', '管理学院'],
              ['经济学类', '经济学院'],
              ['文法学类', '法学与人文社会学院'],
              ['艺术学类', '艺术与设计学院'],
              ['交叉学科', '安全科学与应急管理学院'],
              ['基础教育', '马克思主义学院'],
              ['基础教育', '外国语学院'],
              ['基础教育', '体育学院'],
              ['国际教育', '国际教育学院'],
            ];
            return items.map(function(item, i) {
              return new TableRow({
                children: [
                  dataCell(item[0], 4680, { shading: i % 2 === 0 ? C.light : undefined }),
                  dataCell(item[1], 4680, { shading: i % 2 === 0 ? C.light : undefined }),
                ],
              });
            });
          })(),
        }),

        spacer(),
        new Paragraph({ children: [new PageBreak()] }),

        // ===== Section 5 =====
        heading1('五、师资力量'),
        para(zq('武汉理工大学拥有一支高水平的师资队伍，现有教职工5300余人，其中专任教师约3100人。学校坚持"人才强校"战略，汇聚了一大批学术造诺深厚、教学经验丰富的专家学者。')),
        spacer(60),

        new Table({
          columnWidths: [4680, 4680],
          rows: (function() {
            var items = [
              ['专任教师', '约3,100人'],
              ['教授、研究员', '700余人'],
              ['副教授、副研究员', '1,200余人'],
              ['中国科学院院士', '2人（含双聘）'],
              ['中国工程院院士', '5人（含双聘）'],
              ['国家杰出青年科学基金获得者', '15人'],
              ['国家优秀青年科学基金获得者', '12人'],
              ['国家级教学名师', '6人'],
              ['百千万人才工程国家级人选', '12人'],
              ['博士生导师', '600余人'],
              ['具有海外留学背景教师', '占比约40%'],
            ];
            return items.map(function(item, i) {
              return new TableRow({
                children: [
                  dataCell(item[0], 4680, { shading: i % 2 === 0 ? C.light : undefined, bold: true }),
                  dataCell(item[1], 4680, { shading: i % 2 === 0 ? C.light : undefined }),
                ],
              });
            });
          })(),
        }),

        spacer(),
        new Paragraph({ children: [new PageBreak()] }),

        // ===== Section 6 =====
        heading1('六、校园设施'),
        heading2('图书馆'),
        para('武汉理工大学图书馆由三校区图书馆组成，总建筑面积约7.7万平方米，阅览座位8000余个。馆藏纸质图书超过370万册，电子图书约300万册，中外文数据库约200个。图书馆提供24小时自习室、自助借还、学术信息检索、数字资源远程访问等全方位服务。'),
        spacer(60),

        heading2('实验室与科研平台'),
        para('学校拥有多个国家级和省部级科研平台，为人才培养和科学研究提供了坚实的支撑：'),
        bulletItem('硅酸盐建筑材料国家重点实验室'),
        bulletItem('材料复合新技术国家重点实验室（联合）'),
        bulletItem('光纤传感技术与网络国家工程研究中心'),
        bulletItem('国家水运安全工程技术研究中心'),
        bulletItem('燃料电池湖北省重点实验室'),
        bulletItem('湖北省新能源汽车工程技术研究中心'),
        bulletItem('湖北省数字制造重点实验室'),
        spacer(60),

        heading2('体育场馆'),
        para('学校体育设施先进齐全，三校区均建有完善的体育场馆：'),
        bulletItem('南湖校区综合体育馆（可容纳6,000人）'),
        bulletItem('马房山校区体育馆'),
        bulletItem('余家头校区体育馆'),
        bulletItem('标准化田径场（3个）'),
        bulletItem('游泳池（2个）'),
        bulletItem('篮球场、排球场、网球场等室外运动地地30余片'),
        spacer(60),

        heading2('学生公寓与生活设施'),
        para('学生宿舍全部为标准公寓化配置，南湖校区和余家头校区大部分宿舍配备空调、热水器和独立卫生间。校内设有学生食堂10余个，提供多样化餐饮选择。校医院、银行网点、超市、快递服务站等生活配套设施齐全。'),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 200, after: 100 },
          border: { top: { style: BorderStyle.SINGLE, size: 1, color: C.border, space: 8 }, bottom: { style: BorderStyle.SINGLE, size: 1, color: C.border, space: 8 } },
          children: [new TextRun({ text: zq('※ 学校持续推进校园信息化建设，Wi-Fi全覆盖，"智慧理工大"一站式服务平台为师生提供便捷的线上服务。'), size: 20, italics: true, color: C.gray, font: 'Microsoft YaHei' })],
        }),

        spacer(),
        new Paragraph({ children: [new PageBreak()] }),

        // ===== Section 7 =====
        heading1('七、校园文化'),
        heading2(zq('校训：厚德博学、追求卓越')),
        para(zq('“厚德博学”取自《周易》“君子以厚德载物”和《论语》“博学而笃志”，体现了学校对师生道德修养和学识积累的深厚期望。“追求卓越”则代表了武汉理工人精益求精、奋发向上的精神风貌。')),
        spacer(60),

        heading2('校园精神'),
        para(zq('武汉理工大学在百余年的办学实践中，形成了以"卓越精神"为核心的校园文化体系。学校坚持"育人为本、学术至上"的办学理念，培养了一大批具有社会责任感、创新精神和实践能力的优秀人才。')),
        spacer(60),

        heading2('学生活动'),
        para('学校拥有各类学生社团200余个，涵盖科技创新、文化艺术、体育竞技、志愿服务等各个领域。特色品牌活动包括：'),
        bulletItem(zq('“理工大讲堂”——高端学术讲座品牌')),
        bulletItem(zq('“校园文化艺术节”——年度大型文化活动')),
        bulletItem(zq('“创新杯”大学生课外学术科技作品竞赛')),
        bulletItem(zq('“理工杯”体育赛事系列')),
        bulletItem(zq('“志愿服务月”——常态化公益实践活动')),
        bulletItem(zq('“社团文化节”——展示社团风采的舞台')),
        spacer(60),

        heading2('校园标志'),
        para(zq('学校的标志性建筑——飞马广场聽立于马房山校区中心，一匹奋蹄腾飞的白马雕塑象征着武汉理工大学蒸蒸日上、锐意进取的精神追求。校徽以"WUT"三个字母为主体设计元素，融合了"理工"与"交通"的意象。')),

        spacer(),
        new Paragraph({ children: [new PageBreak()] }),

        // ===== Section 8 =====
        heading1('八、国际合作与交流'),
        para('武汉理工大学坚持国际化办学战略，与全球40多个国家和地区的200余所高校和科研机构建立了稳定的合作关系。学校是联合国教科文组织产学合作教席单位，与多所国际知名高校开展了形式多样的合作办学项目。'),
        spacer(60),

        heading2('国际合作项目'),
        bulletItem(zq('中英合作办学项目——与英国多所大学开展本科及研究生联合培养')),
        bulletItem(zq('中美合作办学项目——与多所美国大学开展"2+2"等双学位项目')),
        bulletItem(zq('中法合作办学项目——与法国高校开展工程师教育合作')),
        bulletItem(zq('中澳合作办学项目——与澳大利亚高校开展学分互认交换项目')),
        bulletItem(zq('教育部"丝绸之路"中国政府奖学金项目——招收培养沿线国家留学生')),
        spacer(60),

        heading2('国际化数据'),
        para('学校现有来自80余个国家的国际学生约1,500人，每年派出约500名学生赴海外交流学习。学校在材料科学、交通工程等领域的国际学术影响力持续提升，多次主办或承办大型国际学术会议。'),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 200, after: 100 },
          border: { top: { style: BorderStyle.SINGLE, size: 1, color: C.border, space: 8 }, bottom: { style: BorderStyle.SINGLE, size: 1, color: C.border, space: 8 } },
          children: [new TextRun({ text: zq('※ 学校建有"一带一路"国际教育合作平台，与沿线国家高校在人才培养、科学研究等领域开展深度合作。'), size: 20, italics: true, color: C.gray, font: 'Microsoft YaHei' })],
        }),

        spacer(),
        new Paragraph({ children: [new PageBreak()] }),

        // ===== Section 9 =====
        heading1('九、招生就业'),
        heading2('招生概况'),
        para('武汉理工大学面向全国31个省（自治区、直辖市）招生，年招收本科生约9,200人，硕士研究生约5,800人，博士研究生约800人。学校在各省的录取分数线稳居同类院校前列，生源质量持续向好。'),
        spacer(60),

        heading2('就业前景'),
        para(zq('学校毕业生以"基础扎实、能力强、素质高"深受社会欢迎，本科生就业率连续多年保持在95%以上。毕业生主要就业方向包括：')),
        bulletItem('世界500强企业——华为、中兴、上汽、东风、中国建筑、中国交建等'),
        bulletItem('国家部委及事业单位'),
        bulletItem('科研院所和高等院校'),
        bulletItem('自主创业及继续深造（考研、出国留学）'),
        spacer(60),

        heading2('知名校友'),
        para('武汉理工大学培养了数十万名各类高级专门人才，涌现出一大批政界精英、学术太斗和商界翎楚。代表性校友包括：'),
        bulletItem('中国工程院院士、材料科学专家赵东元'),
        bulletItem('东风汽车集团有限公司董事长笊延风'),
        bulletItem('中国交通建设集团有限公司董事长王彤宙'),
        bulletItem('以及来自船舶、汽车、建材等行业的众多领军人物'),

        spacer(),
        new Paragraph({ children: [new PageBreak()] }),

        // ===== Section 10 =====
        heading1('十、联系方式'),
        spacer(100),

        new Table({
          columnWidths: [3000, 6360],
          rows: (function() {
            var items = [
              ['学校总机', '027-87651428'],
              ['招生办公室', '027-87859017 / 027-87658160'],
              ['研究生招生办', '027-87651413'],
              ['国际交流与合作处', '027-87658258'],
              ['学生就业指导中心', '027-87651101'],
              ['校医院', '027-87652003（马房山） / 027-86551120（余家头）'],
              ['学校官方网站', 'www.whut.edu.cn'],
              ['招生信息网', 'zs.whut.edu.cn'],
              ['电子邮箱', 'webmaster@whut.edu.cn'],
            ];
            return items.map(function(item, i) {
              var isH = i === 0;
              if (isH) {
                return new TableRow({
                  tableHeader: true,
                  children: [headerCell('部门/项目', 3000), headerCell('联系方式', 6360)],
                });
              }
              return new TableRow({
                children: [
                  dataCell(item[0], 3000, { bold: true, shading: i % 2 === 0 ? C.light : undefined }),
                  dataCell(item[1], 6360, { shading: i % 2 === 0 ? C.light : undefined }),
                ],
              });
            });
          })(),
        }),

        spacer(200),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          border: { top: { style: BorderStyle.SINGLE, size: 2, color: C.primary, space: 8 } },
          spacing: { before: 200, after: 100 },
          children: [],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 100, after: 60 },
          children: [new TextRun({ text: '热诚欢迎海内外学子报考武汉理工大学！', size: 26, bold: true, color: C.primary, font: 'Microsoft YaHei' })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 60, after: 60 },
          children: [new TextRun({ text: '厚德博学 · 追求卓越', size: 24, color: C.accent, font: 'Microsoft YaHei', italics: true })],
        }),
        spacer(200),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: '— 本手册由武汉理工大学校园资料编委会整理出品 —', size: 18, color: C.gray, font: 'Microsoft YaHei', italics: true })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: '资料整理日期：2025年7月', size: 18, color: C.gray, font: 'Microsoft YaHei' })],
        }),
      ],
    },
  ],
});

Packer.toBuffer(doc).then(function(buffer) {
  var outPath = 'D:\\Vue3_武理小精灵\\武汉理工大学校园资料手册.docx';
  fs.writeFileSync(outPath, buffer);
  console.log('Done: ' + fs.statSync(outPath).size + ' bytes');
});
