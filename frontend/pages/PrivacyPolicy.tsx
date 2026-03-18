import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

const PrivacyPolicy: React.FC = () => {
  const navigate = useNavigate();
  const { theme } = useTheme();

  const isDark = theme === 'dark';
  const text = isDark ? 'text-[#ededed]' : 'text-gray-900';
  const textSec = isDark ? 'text-[#ededed]/70' : 'text-gray-600';
  const bg = isDark ? 'bg-[#070A12]' : 'bg-gray-50';
  const card = isDark ? 'bg-[#161b22]' : 'bg-white';
  const infoBox = isDark ? 'bg-[#070A12]' : 'bg-gray-50';

  return (
    <div className={`min-h-screen ${bg}`}>
      {/* Header */}
      <div className={`sticky top-0 z-10 backdrop-blur-md ${isDark ? 'bg-[#070A12]/80 border-b border-white/10' : 'bg-gray-50/80 border-b border-gray-200'}`}>
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center gap-4">
          <button onClick={() => navigate('/')} className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-white/10 text-[#ededed]' : 'hover:bg-gray-200 text-gray-900'}`}>
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className={`text-lg font-semibold ${text}`}>Privacy Policy</h1>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-6 py-10">
        <div className={`rounded-2xl p-8 md:p-12 ${card} shadow-lg`}>
          {/* Title */}
          <div className="mb-10">
            <h1 className={`text-4xl font-bold mb-1 ${text}`}>NEBULAA</h1>
            <h2 className="text-2xl font-bold text-[#ffcc29] mb-2">Privacy Policy</h2>
            <p className={`text-sm italic ${textSec}`}>Effective Date: 10 March 2025 | Version 1.0</p>
            <p className={`text-sm italic ${textSec}`}>Governing Entity: Noburo Business Services LLP, India</p>
          </div>

          <div className={`space-y-8 leading-relaxed ${textSec}`}>
            {/* Preamble */}
            <div className={`border-l-4 border-[#ffcc29] pl-4 italic ${textSec}`}>
              At Nebulaa, we take your privacy seriously. This Privacy Policy describes how Noburo Business Services LLP collects, uses, stores, discloses, and protects your personal information when you use the Nebulaa platform. Please read this policy carefully before providing your information.
            </div>

            {/* 1 */}
            <section>
              <h2 className={`text-xl font-bold mb-4 ${text}`}>1. Identity of Data Controller</h2>
              <p className="mb-3">The data controller responsible for your personal data is:</p>
              <div className={`rounded-lg p-5 space-y-1 ${infoBox}`}>
                <p><strong className={text}>Noburo Business Services LLP</strong></p>
                <p>Platform: Nebulaa — www.nebulaa.ai</p>
                <p>Registered in India under the Limited Liability Partnership Act, 2008</p>
                <p>Email for support & grievance: <a href="mailto:support@nebulaa.ai" className="text-[#ffcc29] hover:underline">support@nebulaa.ai</a></p>
              </div>
            </section>

            {/* 2 */}
            <section>
              <h2 className={`text-xl font-bold mb-4 ${text}`}>2. Information We Collect</h2>
              <p className="mb-4">We collect information that you provide to us directly, information generated through your use of the Platform, and information from third parties where applicable. The categories of information we collect include:</p>

              <h3 className={`text-lg font-semibold mb-3 ${text}`}>2.1 Information You Provide Directly</h3>
              <ul className="list-disc pl-6 space-y-2 mb-4">
                <li><strong className={text}>Identity data:</strong> Full name, display name, professional title, and photograph (if uploaded);</li>
                <li><strong className={text}>Contact data:</strong> Email address, phone number, and location (city/country);</li>
                <li><strong className={text}>Account credentials:</strong> Password (stored in hashed form) and authentication tokens;</li>
                <li><strong className={text}>Business data:</strong> Company name, stage, sector, revenue information, team size, and any other business context you provide;</li>
                <li><strong className={text}>Decision & operational data:</strong> GTM decisions, experiments, outcomes, learnings, and action records you log on the Platform;</li>
                <li><strong className={text}>Payment data:</strong> Billing name, GST number, and invoice details. Full card or bank account numbers are processed directly by Razorpay and not stored by us;</li>
                <li><strong className={text}>Communications:</strong> Messages, feedback, support requests, or any content you send to us.</li>
              </ul>

              <h3 className={`text-lg font-semibold mb-3 ${text}`}>2.2 Information Collected Automatically</h3>
              <ul className="list-disc pl-6 space-y-2 mb-4">
                <li><strong className={text}>Usage data:</strong> Pages visited, features used, actions taken, time spent, click paths, and session duration;</li>
                <li><strong className={text}>Device & technical data:</strong> IP address, browser type and version, operating system, device identifiers, time zone, and screen resolution;</li>
                <li><strong className={text}>Log data:</strong> Server access logs, error logs, and Platform event logs;</li>
                <li><strong className={text}>Cookies and tracking technologies:</strong> As described in Section 10 below.</li>
              </ul>

              <h3 className={`text-lg font-semibold mb-3 ${text}`}>2.3 Information from Third Parties</h3>
              <ul className="list-disc pl-6 space-y-2">
                <li>If you authenticate via third-party single sign-on (e.g., Google OAuth), we may receive your name, email, and profile picture from that service;</li>
                <li>Payment processors (Razorpay) may share transaction status and anonymised billing information with us;</li>
                <li>Analytics and infrastructure providers may process technical usage data on our behalf.</li>
              </ul>
            </section>

            {/* 3 */}
            <section>
              <h2 className={`text-xl font-bold mb-4 ${text}`}>3. Purposes & Legal Basis for Processing</h2>
              <p className="mb-4">We process your personal data for the following purposes:</p>
              <ul className="list-disc pl-6 space-y-2 mb-4">
                <li><strong className={text}>Account Creation & Authentication:</strong> To register, verify, and maintain your account on the Platform.</li>
                <li><strong className={text}>Service Delivery:</strong> To provide you with the features, tools, and AI-powered functionalities of the Platform, including decision tracking, action planning, and outcome analysis.</li>
                <li><strong className={text}>Trial Management:</strong> To manage your free trial period, track eligibility, and communicate about trial expiry and upgrade options.</li>
                <li><strong className={text}>Billing & Payments:</strong> To process your Subscription payments, generate invoices, manage renewals, and comply with GST and financial record-keeping obligations.</li>
                <li><strong className={text}>Customer Support:</strong> To respond to your queries, troubleshoot issues, and provide assistance.</li>
                <li><strong className={text}>Platform Improvement:</strong> To analyse usage patterns, identify bugs, improve AI model performance, and develop new features.</li>
                <li><strong className={text}>Communications:</strong> To send you service-related notices, product updates, security alerts, and — where you have opted in — marketing communications.</li>
                <li><strong className={text}>Legal Compliance:</strong> To comply with applicable Indian laws, regulations, and court or regulatory orders.</li>
                <li><strong className={text}>Safety & Security:</strong> To detect, prevent, and investigate fraud, abuse, security incidents, and violations of our Terms.</li>
              </ul>
              <p className="mb-4">Legal bases under Indian law (Information Technology Act, 2000; IT (Reasonable Security Practices and Procedures and Sensitive Personal Data or Information) Rules, 2011; and the Digital Personal Data Protection Act, 2023, upon its notification):</p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Your consent (which you may withdraw at any time, subject to legal and contractual constraints);</li>
                <li>Performance of a contract with you (your Subscription agreement);</li>
                <li>Compliance with a legal obligation;</li>
                <li>Legitimate interests pursued by us or a third party, where not overridden by your rights.</li>
              </ul>
            </section>

            {/* 4 */}
            <section>
              <h2 className={`text-xl font-bold mb-4 ${text}`}>4. How We Use Your Data</h2>
              <p className="mb-4">In addition to the purposes above, we use your data to:</p>
              <ul className="list-disc pl-6 space-y-2 mb-4">
                <li>Personalise your experience and surface relevant recommendations through our AI models;</li>
                <li>Conduct aggregate, anonymised analysis and research to improve the Platform's decision feedback capabilities;</li>
                <li>Train and improve AI/ML models, using anonymised and de-identified data only, unless you provide explicit consent for identifiable data use;</li>
                <li>Enforce our Terms & Conditions and other policies;</li>
                <li>Protect the rights, property, and safety of the Company, our users, and the public.</li>
              </ul>
              <p className="font-semibold">We will not sell your personal data to third parties. We will not use your personal data for advertising or marketing purposes by third parties without your explicit consent.</p>
            </section>

            {/* 5 */}
            <section>
              <h2 className={`text-xl font-bold mb-4 ${text}`}>5. Data Sharing & Disclosure</h2>
              <p className="mb-4">We do not sell, rent, or trade your personal data. We may share your data in the following limited circumstances:</p>

              <h3 className={`text-lg font-semibold mb-3 ${text}`}>5.1 Service Providers</h3>
              <p className="mb-2">We engage trusted third-party vendors to support our operations. These include:</p>
              <ul className="list-disc pl-6 space-y-2 mb-2">
                <li>Cloud hosting and infrastructure providers (data processing within their servers);</li>
                <li>Payment gateway: Razorpay (for Subscription billing);</li>
                <li>Analytics services (e.g., product analytics platforms);</li>
                <li>Email and communication service providers;</li>
                <li>AI/ML infrastructure providers (for model hosting and inference).</li>
              </ul>
              <p className="mb-4">All service providers are bound by data processing agreements and may only use your data as instructed by us.</p>

              <h3 className={`text-lg font-semibold mb-3 ${text}`}>5.2 Legal & Regulatory Disclosure</h3>
              <p className="mb-4">We may disclose your data if required to do so by applicable law, regulation, court order, or governmental authority, or to enforce our legal rights.</p>

              <h3 className={`text-lg font-semibold mb-3 ${text}`}>5.3 Business Transfers</h3>
              <p className="mb-4">In the event of a merger, acquisition, restructuring, or sale of all or part of our business, your data may be transferred to the successor entity. You will be notified of any such transfer and your rights therein.</p>

              <h3 className={`text-lg font-semibold mb-3 ${text}`}>5.4 With Your Consent</h3>
              <p className="mb-4">We may share your data with third parties when you have explicitly consented to such sharing.</p>

              <h3 className={`text-lg font-semibold mb-3 ${text}`}>5.5 Aggregated & Anonymised Data</h3>
              <p>We may share aggregated, anonymised, or de-identified data that cannot reasonably identify you, for research, analytics, or commercial purposes.</p>
            </section>

            {/* 6 */}
            <section>
              <h2 className={`text-xl font-bold mb-4 ${text}`}>6. Data Retention</h2>
              <p className="mb-4">We retain your personal data for as long as your account is active, as necessary to provide you with the Services, or as required by applicable laws and regulations.</p>
              <ul className="list-disc pl-6 space-y-2 mb-4">
                <li><strong className={text}>Active account data:</strong> Retained for the duration of your Subscription plus 2 years post-termination for legal and audit purposes;</li>
                <li><strong className={text}>Trial data:</strong> Retained for 90 days post-trial expiry if you do not convert to a paid plan, after which it is deleted or anonymised;</li>
                <li><strong className={text}>Financial and billing records:</strong> Retained for 7 years as required under Indian tax and accounting laws;</li>
                <li><strong className={text}>Usage logs and analytics:</strong> Retained for up to 24 months, after which they are anonymised;</li>
                <li><strong className={text}>Support communications:</strong> Retained for 3 years from the date of last communication.</li>
              </ul>
              <p>You may request deletion of your data at any time (see Section 9). We will comply subject to our legal retention obligations.</p>
            </section>

            {/* 7 */}
            <section>
              <h2 className={`text-xl font-bold mb-4 ${text}`}>7. Data Security</h2>
              <p className="mb-4">We implement appropriate technical and organisational measures to protect your personal data against unauthorised access, accidental loss, disclosure, alteration, or destruction. These measures include:</p>
              <ul className="list-disc pl-6 space-y-2 mb-4">
                <li>Encryption of data in transit using TLS/SSL protocols;</li>
                <li>Encryption of sensitive data at rest;</li>
                <li>Access controls limiting data access to authorised personnel only;</li>
                <li>Regular security assessments and vulnerability testing;</li>
                <li>Incident response procedures for security breaches.</li>
              </ul>
              <p className="mb-4">In the event of a personal data breach that poses a risk to your rights, we will notify you and relevant authorities as required by applicable law, within the timelines prescribed.</p>
              <p>However, no system can guarantee absolute security. You acknowledge the inherent risks of transmitting data over the internet and agree that we are not responsible for breaches arising from factors beyond our reasonable control.</p>
            </section>

            {/* 8 */}
            <section>
              <h2 className={`text-xl font-bold mb-4 ${text}`}>8. Data Transfers</h2>
              <p className="mb-4">Nebulaa is primarily operated from India. Your data may be processed or stored on servers located in India or in other jurisdictions where our service providers operate (e.g., cloud infrastructure providers operating globally).</p>
              <p>Where data is transferred outside India, we ensure appropriate safeguards are in place, including contractual protections consistent with applicable Indian data protection law and the requirements of the Digital Personal Data Protection Act, 2023.</p>
            </section>

            {/* 9 */}
            <section>
              <h2 className={`text-xl font-bold mb-4 ${text}`}>9. Your Rights</h2>
              <p className="mb-4">Subject to applicable law, you have the following rights with respect to your personal data:</p>
              <ul className="list-disc pl-6 space-y-2 mb-4">
                <li><strong className={text}>Right to Access:</strong> Request a copy of the personal data we hold about you;</li>
                <li><strong className={text}>Right to Correction:</strong> Request correction of inaccurate or incomplete personal data;</li>
                <li><strong className={text}>Right to Erasure:</strong> Request deletion of your personal data, subject to our legal retention obligations;</li>
                <li><strong className={text}>Right to Portability:</strong> Request your data in a structured, machine-readable format;</li>
                <li><strong className={text}>Right to Withdraw Consent:</strong> Withdraw consent at any time where processing is based on consent, without affecting the lawfulness of prior processing;</li>
                <li><strong className={text}>Right to Object:</strong> Object to processing based on legitimate interests, including for direct marketing;</li>
                <li><strong className={text}>Right to Restrict Processing:</strong> Request that we limit how we use your data in certain circumstances;</li>
                <li><strong className={text}>Right to Grievance Redressal:</strong> Lodge a complaint with our Grievance Officer (see Section 12).</li>
              </ul>
              <p>To exercise any of these rights, please contact us at <a href="mailto:privacy@nebulaa.ai" className="text-[#ffcc29] hover:underline">privacy@nebulaa.ai</a>. We will respond within 30 days. We may need to verify your identity before processing your request.</p>
            </section>

            {/* 10 */}
            <section>
              <h2 className={`text-xl font-bold mb-4 ${text}`}>10. Cookies & Tracking Technologies</h2>
              <p className="mb-4">We use cookies, web beacons, local storage, and similar technologies to enhance your experience, analyse usage, and maintain your session.</p>
              <p className={`font-semibold mb-3 ${text}`}>Types of cookies we use:</p>
              <ul className="list-disc pl-6 space-y-2 mb-4">
                <li><strong className={text}>Essential cookies:</strong> Required for the Platform to function correctly (e.g., session management, authentication);</li>
                <li><strong className={text}>Analytical cookies:</strong> Used to understand how users interact with the Platform and improve its features;</li>
                <li><strong className={text}>Preference cookies:</strong> Used to remember your settings and personalisation choices;</li>
                <li><strong className={text}>Marketing cookies:</strong> Used only with your prior consent to deliver relevant communications.</li>
              </ul>
              <p className="mb-4">You can control cookies through your browser settings. Note that disabling essential cookies may impair the functionality of the Platform.</p>
              <p>By using the Platform, you consent to our use of cookies as described herein. You may withdraw this consent at any time by adjusting your cookie preferences or browser settings.</p>
            </section>

            {/* 11 */}
            <section>
              <h2 className={`text-xl font-bold mb-4 ${text}`}>11. Children's Privacy</h2>
              <p className="mb-4">The Nebulaa Platform is intended for business users and is not directed at individuals under the age of 18. We do not knowingly collect personal data from minors.</p>
              <p>If you believe we have inadvertently collected data from a minor, please contact us immediately at <a href="mailto:privacy@nebulaa.ai" className="text-[#ffcc29] hover:underline">privacy@nebulaa.ai</a> and we will promptly delete such data.</p>
            </section>

            {/* 12 */}
            <section>
              <h2 className={`text-xl font-bold mb-4 ${text}`}>12. Grievance Officer</h2>
              <p className="mb-4">In accordance with the Information Technology Act, 2000 and applicable rules, we have appointed a Grievance Officer to address privacy-related concerns:</p>
              <div className={`rounded-lg p-5 space-y-1 ${infoBox}`}>
                <p><strong className={text}>Grievance Officer:</strong> Navaneetha Krishnan</p>
                <p><strong className={text}>Organisation:</strong> Noburo Business Services LLP (Nebulaa)</p>
                <p><strong className={text}>Email:</strong> <a href="mailto:support@nebulaa.ai" className="text-[#ffcc29] hover:underline">support@nebulaa.ai</a></p>
                <p><strong className={text}>Response Time:</strong> We will acknowledge your grievance within 48 hours and resolve it within 30 days.</p>
              </div>
            </section>

            {/* 13 */}
            <section>
              <h2 className={`text-xl font-bold mb-4 ${text}`}>13. Changes to This Privacy Policy</h2>
              <p className="mb-4">We may update this Privacy Policy from time to time to reflect changes in our practices, the Platform, or applicable law. We will notify you of material changes by:</p>
              <ul className="list-disc pl-6 space-y-2 mb-4">
                <li>Posting a prominent notice within the Platform;</li>
                <li>Sending an email to the address associated with your account.</li>
              </ul>
              <p className="mb-4">We encourage you to review this Privacy Policy periodically. Your continued use of the Platform after any changes constitutes your acceptance of the updated policy.</p>
              <p>The "Effective Date" at the top of this document indicates when this policy was last updated.</p>
            </section>

            {/* 14 */}
            <section>
              <h2 className={`text-xl font-bold mb-4 ${text}`}>14. Governing Law</h2>
              <p className="mb-4">This Privacy Policy is governed by the laws of India, including the Information Technology Act, 2000, the IT (SPDI) Rules, 2011, and the Digital Personal Data Protection Act, 2023, as amended or notified from time to time.</p>
              <p>Disputes arising under this Policy shall be subject to the jurisdiction of the courts in Chennai, Tamil Nadu, India.</p>
            </section>

            {/* 15 */}
            <section>
              <h2 className={`text-xl font-bold mb-4 ${text}`}>15. Contact Us</h2>
              <p className="mb-4">For any privacy-related questions, requests, or concerns, please contact:</p>
              <div className={`rounded-lg p-5 space-y-1 ${infoBox}`}>
                <p><strong className={text}>Noburo Business Services LLP</strong></p>
                <p>Platform: Nebulaa — www.nebulaa.ai</p>
                <p>Support Email: <a href="mailto:support@nebulaa.ai" className="text-[#ffcc29] hover:underline">support@nebulaa.ai</a></p>
              </div>
              <div className={`mt-6 border-l-4 border-[#ffcc29] pl-4 italic ${textSec}`}>
                Your privacy is important to us. We are committed to handling your personal data with transparency, integrity, and care.
              </div>
              <p className={`mt-4 text-sm italic ${textSec}`}>Last Updated: 10 March 2025 | Document Version: 1.0</p>
            </section>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center mt-10 pb-10">
          <p className={`text-sm ${isDark ? 'text-[#ededed]/50' : 'text-gray-400'}`}>
            &copy; 2024 Noburo Business Services LLP. All rights reserved.
          </p>
          <div className={`mt-3 flex items-center justify-center gap-4 text-sm ${isDark ? 'text-[#ededed]/50' : 'text-gray-400'}`}>
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
