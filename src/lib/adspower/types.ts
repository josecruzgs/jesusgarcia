export type AdsPowerListResponse<T> = {
  code: number;
  msg: string;
  data: T;
};

export type AdsPowerGroup = {
  group_id: string;
  group_name: string;
  remark: string;
};

export type AdsPowerTag = {
  id: string;
  name: string;
  color: string;
};

export type AdsPowerProfile = {
  user_id: string;
  name: string;
  group_id: string;
  group_name?: string;
  remark?: string;
  domain_name?: string;
  username?: string;
  last_open_time?: string;
  // El campo real en la Local API se llama "fbcc_user_tag" (no "tags") —
  // confirmado contra la respuesta real de /api/v1/user/list.
  fbcc_user_tag?: AdsPowerTag[];
};

export type AdsPowerStartBrowserData = {
  ws: {
    puppeteer: string;
    selenium: string;
  };
  debug_port: string;
  webdriver: string;
};
