import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

const PrivacyPolicy: React.FC = () => {
  const navigate = useNavigate();
  const { theme } = useTheme();

  return (
    <div className={`min-h-screen ${theme === 'dark' ? 'bg-[#070A12]' : 'bg-gray-50'}`}>
      {/* Header */}
      <div className={`sticky top-0 z-10 backdrop-blur-md ${theme === 'dark' ? 'bg-[#070A12]/80 border-b border-white/10' : 'bg-gray-50/80 border-b border-gray-200'}`}>
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center gap-4">
          <button
            onClick={() => navigate('/')}
            className={`p-2 rounded-lg transition-colors ${theme === 'dark' ? 'hover:bg-white/10 text-[#ededed]' : 'hover:bg-gray-200 text-gray-900'}`}
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className={`text-lg font-semibold ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
            Privacy Policy
          </h1>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-6 py-10">
        <div className={`rounded-2xl p-8 md:p-12 ${theme === 'dark' ? 'bg-[#161b22]' : 'bg-white'} shadow-lg`}>
          {/* Title */}
          <div className="text-center mb-10">
            <h1 className={`text-3xl md:text-4xl font-bold mb-3 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
              NEBULAA Privacy Policy
            </h1>
            <p className={`text-sm ${theme === 'dark' ? 'text-[#ededed]/70' : 'text-gray-600'}`}>
              Effective Date: 10 March 2025 | Version 1.0
            </p>
            <p className={`text-sm mt-1 ${theme === 'dark' ? 'text-[#ededed]/70' : 'text-gray-600'}`}>
              Governing Entity: Noburo Business Services LLP, India
            </p>
          </div>

          <div className={`space-y-8 ${theme === 'dark' ? 'text-[#ededed]/70' : 'text-gray-600'}`}>
            {/* Preamble */}
            <p className="leading-relaxed">
              <span className="text-[#ffcc29] font-semibold">NEBULAA</span> ("Platform", "we", "us", "our") is an AI-powered social media marketing and management platform owned and operated by <strong className={theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}>Noburo Business Services LLP</strong>, a Limited Liability Partnership registered under the laws of India.
            </p>
            <p className="leading-relaxed">
              This Privacy Policy ("Policy") describes how we collect, use, store, share, and protect your personal and non-personal information when you access or use the NEBULAA platform, including all associated websites, applications, APIs, tools, features, and services.
            </p>
            <p className="leading-relaxed">
              By accessing, registering for, or using the Platform, you acknowledge that you have read, understood, and agree to the practices described in this Policy. If you do not agree with this Policy, you must immediately stop using the Platform.
            </p>
            <p className="leading-relaxed">
              This Policy should be read in conjunction with our Terms and Conditions of Service.
            </p>

            {/* Section 1 */}
            <section>
              <h2 className={`text-xl font-bold mb-4 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                1. Identity of Data Controller
              </h2>
              <p className="leading-relaxed mb-3">
                The data controller responsible for your personal data is:
              </p>
              <div className={`rounded-lg p-5 space-y-2 ${theme === 'dark' ? 'bg-[#070A12]' : 'bg-gray-50'}`}>
                <p><strong className={theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}>Entity:</strong> Noburo Business Services LLP</p>
                <p><strong className={theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}>Registered in:</strong> India</p>
                <p><strong className={theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}>Email:</strong> <a href="mailto:privacy@nebulaa.ai" className="text-[#ffcc29] hover:underline">privacy@nebulaa.ai</a></p>
                <p><strong className={theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}>Website:</strong> <a href="https://nebulaa.ai" target="_blank" rel="noopener noreferrer" className="text-[#ffcc29] hover:underline">nebulaa.ai</a></p>
              </div>
            </section>

            {/* Section 2 */}
            <section>
              <h2 className={`text-xl font-bold mb-4 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                2. Information We Collect
              </h2>
              <p className="leading-relaxed mb-4">
                We collect the following types of information:
              </p>

              <h3 className={`text-lg font-semibold mb-3 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                2.1 Information You Provide Directly
              </h3>
              <ul className="list-disc pl-6 space-y-2 mb-4">
                <li><strong className={theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}>Account Information:</strong> Name, email address, phone number, company name, job title, and password when you register for an account.</li>
                <li><strong className={theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}>Profile Information:</strong> Brand details, industry, target audience demographics, social media account links, and marketing preferences.</li>
                <li><strong className={theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}>Payment Information:</strong> Billing address, payment method details (processed through secure third-party payment gateways such as Razorpay; we do not store full card details).</li>
                <li><strong className={theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}>Content & Communications:</strong> Content you upload, create, or generate using the Platform; messages and communications with our support team; feedback, surveys, and reviews.</li>
                <li><strong className={theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}>Social Media Data:</strong> When you connect your social media accounts, we access data as permitted by those platforms, including posts, engagement metrics, follower data, and analytics.</li>
              </ul>

              <h3 className={`text-lg font-semibold mb-3 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                2.2 Information Collected Automatically
              </h3>
              <ul className="list-disc pl-6 space-y-2 mb-4">
                <li><strong className={theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}>Device & Browser Information:</strong> IP address, browser type and version, operating system, device type, screen resolution, and unique device identifiers.</li>
                <li><strong className={theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}>Usage Data:</strong> Pages visited, features used, clicks, time spent on pages, navigation patterns, and interaction data.</li>
                <li><strong className={theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}>Log Data:</strong> Server logs, error reports, access times, and referring URLs.</li>
                <li><strong className={theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}>Cookies & Tracking Technologies:</strong> We use cookies, web beacons, pixels, and similar technologies to collect information about your browsing behavior (see Section 10).</li>
              </ul>

              <h3 className={`text-lg font-semibold mb-3 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                2.3 Information from Third Parties
              </h3>
              <ul className="list-disc pl-6 space-y-2">
                <li><strong className={theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}>Social Media Platforms:</strong> Data received when you connect your social media accounts (e.g., Instagram, Facebook, X/Twitter, LinkedIn, Google, YouTube).</li>
                <li><strong className={theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}>Analytics Providers:</strong> Data from third-party analytics services to help us understand Platform usage.</li>
                <li><strong className={theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}>Payment Processors:</strong> Transaction confirmation and billing details from payment gateways.</li>
              </ul>
            </section>

            {/* Section 3 */}
            <section>
              <h2 className={`text-xl font-bold mb-4 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                3. Purposes & Legal Basis for Processing
              </h2>
              <p className="leading-relaxed mb-4">
                We process your personal data based on the following legal grounds:
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li><strong className={theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}>Contract Performance:</strong> Processing necessary to provide you with the Services you have subscribed to or requested.</li>
                <li><strong className={theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}>Consent:</strong> Where you have given us explicit consent to process your data for specific purposes (e.g., marketing communications).</li>
                <li><strong className={theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}>Legitimate Interests:</strong> Processing necessary for our legitimate business interests, such as improving the Platform, preventing fraud, and ensuring security, provided these interests are not overridden by your rights.</li>
                <li><strong className={theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}>Legal Obligation:</strong> Processing necessary to comply with applicable laws, regulations, or legal processes.</li>
              </ul>
            </section>

            {/* Section 4 */}
            <section>
              <h2 className={`text-xl font-bold mb-4 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                4. How We Use Your Data
              </h2>
              <p className="leading-relaxed mb-4">
                We use the information we collect for the following purposes:
              </p>
              <h3 className={`text-lg font-semibold mb-3 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                4.1 Service Delivery
              </h3>
              <ul className="list-disc pl-6 space-y-2 mb-4">
                <li>To create and manage your account.</li>
                <li>To provide, maintain, and improve the Platform and its features.</li>
                <li>To process and manage your subscription and payments.</li>
                <li>To enable AI-powered content generation, scheduling, and analytics.</li>
                <li>To facilitate social media account connections and data synchronization.</li>
              </ul>
              <h3 className={`text-lg font-semibold mb-3 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                4.2 Personalization & Improvement
              </h3>
              <ul className="list-disc pl-6 space-y-2 mb-4">
                <li>To personalize your experience and provide tailored content recommendations.</li>
                <li>To analyze usage patterns and improve the Platform's functionality and performance.</li>
                <li>To train and improve our AI models (using aggregated and anonymized data only).</li>
                <li>To conduct research and development.</li>
              </ul>
              <h3 className={`text-lg font-semibold mb-3 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                4.3 Communication
              </h3>
              <ul className="list-disc pl-6 space-y-2 mb-4">
                <li>To send you service-related communications (e.g., account verification, billing, security alerts, system updates).</li>
                <li>To respond to your inquiries, support requests, and feedback.</li>
                <li>To send marketing and promotional communications (with your consent; you can opt out at any time).</li>
              </ul>
              <h3 className={`text-lg font-semibold mb-3 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                4.4 Security & Compliance
              </h3>
              <ul className="list-disc pl-6 space-y-2">
                <li>To detect, prevent, and address fraud, security breaches, and technical issues.</li>
                <li>To enforce our Terms and Conditions and other policies.</li>
                <li>To comply with legal obligations and respond to lawful requests from authorities.</li>
              </ul>
            </section>

            {/* Section 5 */}
            <section>
              <h2 className={`text-xl font-bold mb-4 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                5. Data Sharing & Disclosure
              </h2>
              <p className="leading-relaxed mb-4">
                We do not sell your personal data. We may share your information in the following circumstances:
              </p>
              <h3 className={`text-lg font-semibold mb-3 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                5.1 Service Providers
              </h3>
              <ul className="list-disc pl-6 space-y-2 mb-4">
                <li>We share data with trusted third-party service providers who assist us in operating the Platform, including cloud hosting providers, payment processors, analytics services, email delivery services, and AI/ML service providers.</li>
                <li>These providers are contractually obligated to protect your data and use it only for the purposes we specify.</li>
              </ul>
              <h3 className={`text-lg font-semibold mb-3 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                5.2 Social Media Platforms
              </h3>
              <ul className="list-disc pl-6 space-y-2 mb-4">
                <li>When you connect your social media accounts, data is shared with those platforms as necessary to provide the Services (e.g., posting content, retrieving analytics).</li>
              </ul>
              <h3 className={`text-lg font-semibold mb-3 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                5.3 Legal Requirements
              </h3>
              <ul className="list-disc pl-6 space-y-2 mb-4">
                <li>We may disclose your information if required by law, regulation, legal process, or enforceable governmental request.</li>
                <li>We may also disclose information to protect the rights, property, or safety of Noburo Business Services LLP, our users, or the public.</li>
              </ul>
              <h3 className={`text-lg font-semibold mb-3 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                5.4 Business Transfers
              </h3>
              <ul className="list-disc pl-6 space-y-2 mb-4">
                <li>In the event of a merger, acquisition, reorganization, or sale of assets, your data may be transferred as part of that transaction. We will notify you of any such change and any choices you may have regarding your data.</li>
              </ul>
              <h3 className={`text-lg font-semibold mb-3 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                5.5 With Your Consent
              </h3>
              <ul className="list-disc pl-6 space-y-2">
                <li>We may share your data with third parties when you have given us explicit consent to do so.</li>
              </ul>
            </section>

            {/* Section 6 */}
            <section>
              <h2 className={`text-xl font-bold mb-4 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                6. Data Retention
              </h2>
              <ul className="list-disc pl-6 space-y-2">
                <li>We retain your personal data only for as long as necessary to fulfill the purposes for which it was collected, including to satisfy legal, accounting, or reporting requirements.</li>
                <li><strong className={theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}>Account Data:</strong> Retained for the duration of your account and for a reasonable period after account deletion (typically up to 90 days) to allow for account recovery or to comply with legal obligations.</li>
                <li><strong className={theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}>Payment & Transaction Data:</strong> Retained as required by applicable tax and financial regulations (typically 7 years).</li>
                <li><strong className={theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}>Usage & Analytics Data:</strong> Retained in aggregated and anonymized form for product improvement purposes.</li>
                <li><strong className={theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}>Marketing Data:</strong> Retained until you withdraw your consent or opt out.</li>
                <li>When data is no longer needed, it is securely deleted or anonymized.</li>
              </ul>
            </section>

            {/* Section 7 */}
            <section>
              <h2 className={`text-xl font-bold mb-4 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                7. Data Security
              </h2>
              <p className="leading-relaxed mb-4">
                We implement appropriate technical and organizational measures to protect your personal data, including:
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Encryption of data in transit (TLS/SSL) and at rest.</li>
                <li>Secure access controls and authentication mechanisms.</li>
                <li>Regular security assessments and vulnerability testing.</li>
                <li>Employee training on data protection and privacy.</li>
                <li>Incident response procedures for data breaches.</li>
              </ul>
              <p className="leading-relaxed mt-4">
                However, no method of transmission over the Internet or electronic storage is 100% secure. While we strive to use commercially acceptable means to protect your data, we cannot guarantee its absolute security.
              </p>
            </section>

            {/* Section 8 */}
            <section>
              <h2 className={`text-xl font-bold mb-4 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                8. Data Transfers
              </h2>
              <ul className="list-disc pl-6 space-y-2">
                <li>Your data may be processed and stored on servers located outside your country of residence, including in India and other countries where our service providers operate.</li>
                <li>When we transfer data internationally, we ensure that appropriate safeguards are in place, including contractual clauses, data processing agreements, and compliance with applicable data protection laws.</li>
                <li>By using the Platform, you consent to the transfer of your data to countries that may have different data protection laws than your jurisdiction.</li>
              </ul>
            </section>

            {/* Section 9 */}
            <section>
              <h2 className={`text-xl font-bold mb-4 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                9. Your Rights
              </h2>
              <p className="leading-relaxed mb-4">
                Depending on your jurisdiction, you may have the following rights regarding your personal data:
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li><strong className={theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}>Right to Access:</strong> You have the right to request a copy of the personal data we hold about you.</li>
                <li><strong className={theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}>Right to Rectification:</strong> You have the right to request correction of inaccurate or incomplete personal data.</li>
                <li><strong className={theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}>Right to Erasure:</strong> You have the right to request deletion of your personal data, subject to certain legal exceptions.</li>
                <li><strong className={theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}>Right to Restrict Processing:</strong> You have the right to request that we restrict the processing of your personal data under certain circumstances.</li>
                <li><strong className={theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}>Right to Data Portability:</strong> You have the right to receive your personal data in a structured, commonly used, and machine-readable format.</li>
                <li><strong className={theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}>Right to Object:</strong> You have the right to object to the processing of your personal data for direct marketing purposes or based on legitimate interests.</li>
                <li><strong className={theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}>Right to Withdraw Consent:</strong> Where processing is based on consent, you have the right to withdraw your consent at any time without affecting the lawfulness of prior processing.</li>
                <li><strong className={theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}>Right to Lodge a Complaint:</strong> You have the right to lodge a complaint with a supervisory authority if you believe your data protection rights have been violated.</li>
              </ul>
              <p className="leading-relaxed mt-4">
                To exercise any of these rights, please contact us at <a href="mailto:privacy@nebulaa.ai" className="text-[#ffcc29] hover:underline">privacy@nebulaa.ai</a>. We will respond to your request within 30 days, or as required by applicable law.
              </p>
            </section>

            {/* Section 10 */}
            <section>
              <h2 className={`text-xl font-bold mb-4 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                10. Cookies & Tracking Technologies
              </h2>
              <h3 className={`text-lg font-semibold mb-3 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                10.1 Types of Cookies We Use
              </h3>
              <ul className="list-disc pl-6 space-y-2 mb-4">
                <li><strong className={theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}>Essential Cookies:</strong> Necessary for the Platform to function properly (e.g., session management, authentication).</li>
                <li><strong className={theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}>Functional Cookies:</strong> Enable enhanced features and personalization (e.g., language preferences, theme settings).</li>
                <li><strong className={theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}>Analytics Cookies:</strong> Help us understand how users interact with the Platform (e.g., Google Analytics).</li>
                <li><strong className={theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}>Marketing Cookies:</strong> Used to deliver relevant advertisements and track campaign effectiveness.</li>
              </ul>
              <h3 className={`text-lg font-semibold mb-3 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                10.2 Managing Cookies
              </h3>
              <ul className="list-disc pl-6 space-y-2">
                <li>You can manage or disable cookies through your browser settings.</li>
                <li>Disabling certain cookies may affect the functionality of the Platform.</li>
                <li>For more information about cookies, visit <span className={theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}>www.allaboutcookies.org</span>.</li>
              </ul>
            </section>

            {/* Section 11 */}
            <section>
              <h2 className={`text-xl font-bold mb-4 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                11. Children's Privacy
              </h2>
              <ul className="list-disc pl-6 space-y-2">
                <li>The Platform is not intended for use by individuals under the age of 18 (or the age of legal majority in your jurisdiction).</li>
                <li>We do not knowingly collect personal data from children.</li>
                <li>If we become aware that we have collected data from a child without appropriate consent, we will take steps to delete that information promptly.</li>
                <li>If you believe a child has provided us with personal data, please contact us at <a href="mailto:privacy@nebulaa.ai" className="text-[#ffcc29] hover:underline">privacy@nebulaa.ai</a>.</li>
              </ul>
            </section>

            {/* Section 12 */}
            <section>
              <h2 className={`text-xl font-bold mb-4 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                12. Grievance Officer
              </h2>
              <p className="leading-relaxed mb-3">
                In accordance with the Information Technology Act, 2000 and rules made thereunder, the name and contact details of the Grievance Officer are provided below:
              </p>
              <div className={`rounded-lg p-5 space-y-2 ${theme === 'dark' ? 'bg-[#070A12]' : 'bg-gray-50'}`}>
                <p><strong className={theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}>Name:</strong> Navaneetha Krishnan</p>
                <p><strong className={theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}>Designation:</strong> Grievance Officer</p>
                <p><strong className={theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}>Company:</strong> Noburo Business Services LLP</p>
                <p><strong className={theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}>Email:</strong> <a href="mailto:privacy@nebulaa.ai" className="text-[#ffcc29] hover:underline">privacy@nebulaa.ai</a></p>
              </div>
              <p className="leading-relaxed mt-4">
                The Grievance Officer shall address your concerns and resolve any grievances expeditiously, within 30 days from the date of receipt of the grievance.
              </p>
            </section>

            {/* Section 13 */}
            <section>
              <h2 className={`text-xl font-bold mb-4 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                13. Changes to This Privacy Policy
              </h2>
              <ul className="list-disc pl-6 space-y-2">
                <li>We may update this Privacy Policy from time to time to reflect changes in our practices, technology, legal requirements, or other factors.</li>
                <li>When we make material changes, we will notify you through the Platform or via email.</li>
                <li>The "Effective Date" at the top of this Policy indicates when it was last updated.</li>
                <li>Continued use of the Platform after changes are posted constitutes your acceptance of the revised Policy.</li>
                <li>We encourage you to review this Policy periodically.</li>
              </ul>
            </section>

            {/* Section 14 */}
            <section>
              <h2 className={`text-xl font-bold mb-4 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                14. Governing Law
              </h2>
              <ul className="list-disc pl-6 space-y-2">
                <li>This Privacy Policy shall be governed by and construed in accordance with the laws of India, including but not limited to the Information Technology Act, 2000, the Information Technology (Reasonable Security Practices and Procedures and Sensitive Personal Data or Information) Rules, 2011, and the Digital Personal Data Protection Act, 2023 (as applicable).</li>
                <li>Any disputes arising under this Policy shall be subject to the exclusive jurisdiction of the courts of Chennai, India.</li>
              </ul>
            </section>

            {/* Section 15 */}
            <section>
              <h2 className={`text-xl font-bold mb-4 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                15. Contact Us
              </h2>
              <p className="leading-relaxed mb-3">
                If you have any questions, concerns, or requests regarding this Privacy Policy or our data practices, please contact us:
              </p>
              <div className={`rounded-lg p-5 space-y-2 ${theme === 'dark' ? 'bg-[#070A12]' : 'bg-gray-50'}`}>
                <p><strong className={theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}>Company:</strong> Noburo Business Services LLP</p>
                <p><strong className={theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}>Email (Support):</strong> <a href="mailto:support@nebulaa.ai" className="text-[#ffcc29] hover:underline">support@nebulaa.ai</a></p>
                <p><strong className={theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}>Email (Privacy):</strong> <a href="mailto:privacy@nebulaa.ai" className="text-[#ffcc29] hover:underline">privacy@nebulaa.ai</a></p>
                <p><strong className={theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}>Website:</strong> <a href="https://nebulaa.ai" target="_blank" rel="noopener noreferrer" className="text-[#ffcc29] hover:underline">nebulaa.ai</a></p>
              </div>
            </section>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center mt-10 pb-10">
          <p className={`text-sm ${theme === 'dark' ? 'text-[#ededed]/50' : 'text-gray-400'}`}>
            &copy; {new Date().getFullYear()} Noburo Business Services LLP. All rights reserved.
          </p>
          <div className={`mt-3 flex items-center justify-center gap-4 text-sm ${theme === 'dark' ? 'text-[#ededed]/50' : 'text-gray-400'}`}>
            <a href="/#/terms" className="hover:text-[#ffcc29] transition-colors">Terms & Conditions</a>
            <span>|</span>
            <a href="https://nebulaa.ai" target="_blank" rel="noopener noreferrer" className="hover:text-[#ffcc29] transition-colors">nebulaa.ai</a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PrivacyPolicy;
