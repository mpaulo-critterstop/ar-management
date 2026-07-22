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
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) return null;
        const user = await prisma.user.findUnique({
          where: { username: credentials.username.toLowerCase().trim() },
        });
        if (!user) return null;
        const valid = await bcrypt.compare(credentials.password, user.password);
        if (!valid) return null;
        return {
          id: user.id, username: user.username, email: user.email, name: user.name, role: user.role, office: user.office,
          modules: user.modules, permissions: user.permissions, pmName: user.pmName, techId: user.techId,
        } as any;
      },
    }),
  ],
  callbacks: {
    jwt: async ({ token, user }) => {
      if (user) {
        token.id = user.id;
        token.username = (user as any).username;
        token.role = (user as any).role;
        token.office = (user as any).office;
        token.modules = (user as any).modules;
        token.permissions = (user as any).permissions;
        token.pmName = (user as any).pmName;
        token.techId = (user as any).techId;
      }
      return token;
    },
    session: async ({ session, token }) => {
      if (token && session.user) {
        session.user.id = token.id as string;
        (session.user as any).username = token.username;
        (session.user as any).role = token.role;
        (session.user as any).office = token.office;
        (session.user as any).modules = token.modules;
        (session.user as any).permissions = token.permissions;
        (session.user as any).pmName = token.pmName;
        (session.user as any).techId = token.techId;
      }
      return session;
    },
  },
};
