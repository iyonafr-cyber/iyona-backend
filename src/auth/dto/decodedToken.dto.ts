export interface DecodedJwtToken {
  userId: string;
  email: string;
  role: string;
  iat: number;
  exp: number;
  uniqueId: string;
}
