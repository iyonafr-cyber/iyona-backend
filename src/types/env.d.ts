declare namespace NodeJS {
  interface ProcessEnv {
    // app
    APPNAME: string | undefined;
    // PORT
    PORT: number | undefined;
    // mongoose
    MONGO_URL: string | undefined;
    // crypto js
    ENCRYPTION_KEY: string | undefined;
    // jwt
    JWT_SECRET: string | undefined;
    JWT_AccessTokenExpiry: string | undefined;
    JWT_RefreshTokenExpiry: string | undefined;
    // oauth - google
    GOOGLE_CLIENT_ID: string | undefined;
    GOOGLE_CLIENT_SECRET: string | undefined;
    // oauth - github
    GITHUB_CLIENT_ID: string | undefined;
    GITHUB_CLIENT_SECRET: string | undefined;
  }
}
