export interface FieldDef {
  label: string;
  field: string;
  bold?: boolean;
  format?: string;
  colorRuleId?: string;
  visibleIf?: { field: string; notNull?: boolean; equals?: string };
}

export interface SubqueryColumnDef {
  label: string;
  field: string;
  format?: string;
}

export interface SubquerySectionDef {
  title: string;
  type: 'subquery';
  query: string;
  columns: SubqueryColumnDef[];
  dependsOn: string[];
}

export interface FieldSectionDef {
  title: string;
  type: 'fields';
  fields: FieldDef[];
}

export type DetailSectionDef = FieldSectionDef | SubquerySectionDef;

export interface ColorRule {
  match: string;
  color: string;
}

export interface ColorRuleSet {
  rules: ColorRule[];
  defaultColor?: string;
}

export interface LpiViewConfig {
  version: number;
  loadQuery: string;
  detailSections: DetailSectionDef[];
  colorRules: Record<string, ColorRuleSet>;
}

export const DEFAULT_LOAD_QUERY = `SELECT
  ar.aggregate_id,
  a.application_id,
  a.external_id AS application_external_id,
  a.created_at AS application_created_at,
  a.status AS application_status,
  COALESCE(p.product_name, '') AS product_name,
  ar.protocol_date,
  ar.agg_gen_group_complience,
  COALESCE(c.customer_name, '') AS customer_name,
  COALESCE(c.customer_email, '') AS customer_mail,
  COALESCE(c.organization, '') AS organization,
  COALESCE(c.customer_tel, '') AS customer_phone,
  COALESCE(c.address, '') AS customer_address,
  COALESCE(p.ekn, '') AS ekn,
  p.thickness,
  COALESCE(p.color, '') AS color,
  COALESCE(o.batch_number, '') AS batch_number,
  COALESCE(o.sample_number, '') AS sample_number,
  COALESCE(o.object_name, '') AS object_name,
  COALESCE(p.standard, '') AS standard,
  COALESCE(p.target_comb_group, '') AS target_comb_group,
  COALESCE(p.target_flam_group, '') AS target_flam_group,
  COALESCE(p.target_prop_group, '') AS target_prop_group,
  COALESCE(m.method_abbreviation, '') AS method_abbreviation,
  COALESCE(m.method_name, '') AS method_name,
  COALESCE(m.method_standard, '') AS method_standard,
  ar.agg_avg_smog_temp,
  ar.agg_smog_group,
  ar.agg_smog_complience,
  ar.agg_mass_loss,
  ar.agg_comb_time,
  ar.agg_dam_length,
  ar.agg_comb_bulb,
  ar.agg_group_by_mass,
  ar.agg_group_by_length,
  ar.agg_croup_by_comb_time,
  ar.agg_group_by_bulbe,
  ar.agg_gen_group,
  ar.agg_mass_complience,
  ar.agg_complience_by_length,
  ar.agg_complience_by_comb_time,
  ar.agg_complience_by_bulbe,
  ar.agg_additional_info_1
FROM aggregated_results ar
LEFT JOIN applications a ON ar.application_id = a.application_id
LEFT JOIN products p ON p.product_id = a.product_id
LEFT JOIN customers c ON c.customer_id = a.customer_id
LEFT JOIN objects o ON o.object_id = a.object_id
LEFT JOIN methods m ON m.method_id = a.method_id`;

export const DEFAULT_CONFIG: LpiViewConfig = {
  version: 1,
  loadQuery: DEFAULT_LOAD_QUERY,
  detailSections: [
    {
      title: 'Детали заявки',
      type: 'fields',
      fields: [
        { label: '№ заявки', field: 'application_external_id' },
        { label: 'Дата создания', field: 'application_created_at' },
        { label: 'Статус', field: 'application_status' },
        { label: 'Название материала', field: 'product_name' },
        { label: 'Заказчик', field: 'customer_name' },
        { label: 'Email заказчика', field: 'customer_mail' },
        { label: 'Организация', field: 'organization' },
        { label: 'Телефон', field: 'customer_phone' },
        { label: 'Адрес', field: 'customer_address' },
        { label: 'ЕКН', field: 'ekn' },
        { label: 'Толщина', field: 'thickness', format: '{value} мм' },
        { label: 'Цвет', field: 'color' },
        { label: 'Номер партии', field: 'batch_number' },
        { label: 'Номер образца', field: 'sample_number' },
        { label: 'Объект', field: 'object_name' },
        { label: 'Стандарт', field: 'standard' },
        { label: 'Целевая группа горючести', field: 'target_comb_group' },
        { label: 'Целевая группа воспламеняемости', field: 'target_flam_group' },
        { label: 'Целевая группа распространения', field: 'target_prop_group' },
        { label: 'Метод испытаний', field: 'method_name' },
        { label: 'Дата протокола', field: 'protocol_date', visibleIf: { field: 'application_status', notNull: true } },
      ],
    },
    {
      title: 'Результаты измерений',
      type: 'fields',
      fields: [
        { label: 'Средняя температура дыма', field: 'agg_avg_smog_temp', format: '{value} °C' },
        { label: 'Потеря массы', field: 'agg_mass_loss', format: '{value} %' },
        { label: 'Время горения', field: 'agg_comb_time', format: '{value} с' },
        { label: 'Длина повреждения', field: 'agg_dam_length', format: '{value} мм' },
        { label: 'Падение горящих капель расплава', field: 'agg_comb_bulb' },
      ],
    },
    {
      title: 'Выводы',
      type: 'fields',
      fields: [
        { label: 'Результат испытания', field: 'agg_gen_group', bold: true },
        { label: 'Общая оценка соответствия', field: 'agg_gen_group_complience', bold: true, colorRuleId: 'compliance' },
        { label: 'Группа по дыму', field: 'agg_smog_group' },
        { label: 'Соответствие по дыму', field: 'agg_smog_complience' },
        { label: 'Группа по массе', field: 'agg_group_by_mass' },
        { label: 'Соответствие по массе', field: 'agg_mass_complience' },
        { label: 'Группа по длине', field: 'agg_group_by_length' },
        { label: 'Соответствие по длине', field: 'agg_complience_by_length' },
        { label: 'Группа по времени горения', field: 'agg_croup_by_comb_time' },
        { label: 'Соответствие по времени горения', field: 'agg_complience_by_comb_time' },
        { label: 'Группа по горящим каплям', field: 'agg_group_by_bulbe' },
        { label: 'Соответствие по горящим каплям', field: 'agg_complience_by_bulbe' },
        { label: 'Дополнительная информация', field: 'agg_additional_info_1' },
      ],
    },
  ],
  colorRules: {
    compliance: {
      rules: [
        { match: 'Соответствует', color: 'var(--text-success)' },
        { match: 'Не соответствует', color: 'var(--text-error)' },
      ],
      defaultColor: 'var(--text-muted)',
    },
  },
};
