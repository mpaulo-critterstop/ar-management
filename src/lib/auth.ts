import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "./prisma";
import bcrypt from "bcryptjs";

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
  if (!credentials?.email || !credentials?.password) return null;
  const user = await prisma.user.findUnique({
    where: { email: credentials.email },
  });
  if (!user) {
    console.log('User not found:', credentials.email);
    return null;
  }
  const valid = await bcrypt.compare(credentials.password, user.password);
  console.log('Password valid:', valid, 'hash:', user.password.substring(0, 20));
  if (!valid) return null;
  return { id: user.id, email: user.email, name: user.name, role: user.role, office: user.office };
},
    }),
  ],
  callbacks: {
    jwt: async ({ token, user }) => {
      if (user) {
        token.id = user.id;
        token.role = (user as any).role;
        token.office = (user as any).office;
      }
      return token;
    },
    session: async ({ session, token }) => {
      if (token && session.user) {
        session.user.id = token.id as string;
        (session.user as any).role = token.role;
        (session.user as any).office = token.office;
      }
      return session;
    },
  },
};
